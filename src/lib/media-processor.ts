import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { JobState, MediaKind, MediaStatus } from "@prisma/client";
import { refreshPerceptualHash } from "@/lib/duplicate-detector";
import { prisma } from "@/lib/prisma";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const relativeStoragePath = (absolutePath: string) =>
  path.relative(storageRoot, absolutePath).split(path.sep).join("/");

type JobPhase =
  | "queued"
  | "image:analyze"
  | "image:thumbnail"
  | "image:preview"
  | "video:analyze"
  | "video:thumbnail"
  | "video:preview"
  | "video:stream"
  | "finalizing";

const updateJobPhase = (jobId: string, operation: JobPhase, progress: number) =>
  prisma.processingJob.update({
    where: { id: jobId },
    data: { operation, progress: Math.max(0, Math.min(100, Math.round(progress))) }
  });

const run = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(-1800)}`));
    });
  });

interface ProbeResult {
  format?: {
    duration?: string;
  };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }>;
}

const parseFrameRate = (value?: string) => {
  if (!value) return null;
  const [numerator, denominator = "1"] = value.split("/");
  const rate = Number(numerator) / Number(denominator);
  return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1000) / 1000 : null;
};

async function processImage(
  mediaId: string,
  jobId: string,
  inputPath: string,
  outputDir: string
) {
  const thumbnailPath = path.join(outputDir, "thumbnail.webp");
  const previewPath = path.join(outputDir, "preview.webp");
  await updateJobPhase(jobId, "image:analyze", 10);
  const image = sharp(inputPath, { failOn: "none" });
  const metadata = await image.metadata();
  const stats = await image.stats();
  const dominant = stats.dominant;
  const dominantColor = `#${[dominant.r, dominant.g, dominant.b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;

  await updateJobPhase(jobId, "image:thumbnail", 25);
  await sharp(inputPath, { failOn: "none" })
    .rotate()
    .resize(720, 720, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toFile(thumbnailPath);

  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      width: metadata.width,
      height: metadata.height,
      thumbnailPath: relativeStoragePath(thumbnailPath),
      dominantColor
    }
  });

  await updateJobPhase(jobId, "image:preview", 60);
  await sharp(inputPath, { failOn: "none" })
    .rotate()
    .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toFile(previewPath);

  await updateJobPhase(jobId, "finalizing", 92);
  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      width: metadata.width,
      height: metadata.height,
      thumbnailPath: relativeStoragePath(thumbnailPath),
      previewPath: relativeStoragePath(previewPath),
      dominantColor,
      status: MediaStatus.READY
    }
  });
  await refreshPerceptualHash(mediaId, thumbnailPath);
}

async function processVideo(
  mediaId: string,
  jobId: string,
  inputPath: string,
  outputDir: string
) {
  await updateJobPhase(jobId, "video:analyze", 8);
  const probeOutput = await run("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath
  ]);
  const probe = JSON.parse(probeOutput) as ProbeResult;
  const videoStream = probe.streams?.find((stream) => stream.codec_type === "video");
  const durationSeconds = Number(probe.format?.duration ?? 0);
  const captureAt = Math.max(0.2, Math.min(durationSeconds * 0.18, 30));

  const thumbnailPath = path.join(outputDir, "thumbnail.webp");
  const previewPath = path.join(outputDir, "preview.mp4");
  const hlsDir = path.join(outputDir, "hls");
  const playlistPath = path.join(hlsDir, "master.m3u8");
  const generateHls = process.env.FRAMEO_GENERATE_HLS === "true";
  if (generateHls) await mkdir(hlsDir, { recursive: true });

  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      width: videoStream?.width,
      height: videoStream?.height,
      durationMs: Math.round(durationSeconds * 1000),
      frameRate: parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate)
    }
  });

  await updateJobPhase(jobId, "video:thumbnail", 20);
  await run("ffmpeg", [
    "-y",
    "-ss",
    captureAt.toFixed(2),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-vf",
    "scale=960:-2:force_original_aspect_ratio=decrease",
    "-c:v",
    "libwebp",
    "-quality",
    "82",
    thumbnailPath
  ]);

  const color = await sharp(thumbnailPath).stats();
  const dominant = color.dominant;
  const dominantColor = `#${[dominant.r, dominant.g, dominant.b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      thumbnailPath: relativeStoragePath(thumbnailPath),
      dominantColor
    }
  });

  await updateJobPhase(jobId, "video:preview", 45);
  const segmentCount = durationSeconds >= 10 ? 8 : 1;
  const segmentDuration =
    segmentCount === 1 ? Math.max(0.5, Math.min(6, durationSeconds)) : 0.75;
  const maxSegmentStart = Math.max(0, durationSeconds - segmentDuration);
  const segmentStarts = Array.from({ length: segmentCount }, (_, index) =>
    segmentCount === 1 ? 0 : (maxSegmentStart * index) / (segmentCount - 1)
  );
  const previewArgs = ["-y"];
  for (const start of segmentStarts) {
    const inputWindow = Math.max(
      segmentDuration,
      Math.min(5, durationSeconds - start)
    );
    previewArgs.push(
      "-ss",
      start.toFixed(3),
      "-t",
      inputWindow.toFixed(3),
      "-i",
      inputPath
    );
  }
  const segmentFilters = segmentStarts.map(
    (_, index) =>
      `[${index}:v]scale=720:-2:force_original_aspect_ratio=decrease,` +
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24,setsar=1," +
      `trim=duration=${segmentDuration.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`
  );
  const concatInputs = segmentStarts.map((_, index) => `[v${index}]`).join("");
  previewArgs.push(
    "-filter_complex",
    `${segmentFilters.join(";")};${concatInputs}concat=n=${segmentCount}:v=1:a=0[outv]`,
    "-map",
    "[outv]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "27",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    previewPath
  );
  await run("ffmpeg", previewArgs);

  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: { previewPath: relativeStoragePath(previewPath) }
  });

  if (generateHls) {
    await updateJobPhase(jobId, "video:stream", 72);
    await run("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale=w=1280:h=-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ac",
      "2",
      "-hls_time",
      "4",
      "-hls_playlist_type",
      "vod",
      "-hls_flags",
      "independent_segments",
      "-hls_segment_filename",
      path.join(hlsDir, "segment-%04d.ts"),
      playlistPath
    ]);
  }

  await updateJobPhase(jobId, "finalizing", 94);
  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      width: videoStream?.width,
      height: videoStream?.height,
      durationMs: Math.round(durationSeconds * 1000),
      frameRate: parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
      thumbnailPath: relativeStoragePath(thumbnailPath),
      previewPath: relativeStoragePath(previewPath),
      streamPath: generateHls ? relativeStoragePath(playlistPath) : null,
      dominantColor,
      status: MediaStatus.READY
    }
  });
  await refreshPerceptualHash(mediaId, thumbnailPath);
}

export async function processMediaAsset(mediaId: string, existingJobId?: string) {
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!media) return;

  const inputPath = path.resolve(storageRoot, media.originalPath);
  const outputDir = path.join(storageRoot, "derived", mediaId);
  await mkdir(outputDir, { recursive: true });

  const job = existingJobId
    ? await prisma.processingJob.update({
        where: { id: existingJobId },
        data: {
          state: JobState.RUNNING,
          progress: 4,
          startedAt: new Date(),
          endedAt: null,
          error: null
        }
      })
    : await prisma.processingJob.create({
        data: {
          mediaId,
          operation: "queued",
          state: JobState.RUNNING,
          progress: 4,
          startedAt: new Date()
        }
      });

  try {
    if (media.kind === MediaKind.VIDEO) {
      await processVideo(mediaId, job.id, inputPath, outputDir);
    } else {
      await processImage(mediaId, job.id, inputPath, outputDir);
    }

    await prisma.processingJob.update({
      where: { id: job.id },
      data: {
        state: JobState.COMPLETED,
        progress: 100,
        endedAt: new Date()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    await Promise.all([
      prisma.mediaAsset.update({
        where: { id: mediaId },
        data: { status: MediaStatus.ERROR }
      }),
      prisma.processingJob.update({
        where: { id: job.id },
        data: {
          state: JobState.FAILED,
          error: message.slice(0, 4000),
          endedAt: new Date()
        }
      })
    ]);
    throw error;
  }
}

let processingQueue: Promise<unknown> = Promise.resolve();

export async function enqueueMediaProcessing(mediaId: string) {
  const job = await prisma.processingJob.create({
    data: {
      mediaId,
      operation: "queued",
      state: JobState.PENDING,
      progress: 0
    }
  });
  const task = processingQueue.then(() => processMediaAsset(mediaId, job.id));
  processingQueue = task.catch(() => undefined);
  return task;
}

let recoveryStarted = false;

export async function recoverProcessingQueue() {
  if (recoveryStarted || !process.env.DATABASE_URL || process.env.DEMO_MODE === "true") return;
  recoveryStarted = true;

  const interrupted = await prisma.processingJob.findMany({
    where: { state: JobState.RUNNING },
    select: { id: true }
  });
  if (interrupted.length) {
    await prisma.processingJob.updateMany({
      where: { id: { in: interrupted.map(({ id }) => id) } },
      data: {
        state: JobState.FAILED,
        error: "Elaborazione interrotta dal riavvio; recupero automatico avviato.",
        endedAt: new Date()
      }
    });
  }

  const pendingMedia = await prisma.mediaAsset.findMany({
    where: { status: MediaStatus.PROCESSING },
    select: { id: true },
    orderBy: { createdAt: "asc" }
  });
  for (const media of pendingMedia) {
    void enqueueMediaProcessing(media.id).catch((error) => {
      console.error(`Recovery processing failed for media ${media.id}`, error);
    });
  }
}
