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

async function processImage(mediaId: string, inputPath: string, outputDir: string) {
  const thumbnailPath = path.join(outputDir, "thumbnail.webp");
  const previewPath = path.join(outputDir, "preview.webp");
  const image = sharp(inputPath, { failOn: "none" });
  const metadata = await image.metadata();
  const stats = await image.stats();
  const dominant = stats.dominant;
  const dominantColor = `#${[dominant.r, dominant.g, dominant.b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;

  await Promise.all([
    sharp(inputPath, { failOn: "none" })
      .rotate()
      .resize(720, 720, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .toFile(thumbnailPath),
    sharp(inputPath, { failOn: "none" })
      .rotate()
      .resize(1920, 1920, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toFile(previewPath)
  ]);

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

async function processVideo(mediaId: string, inputPath: string, outputDir: string) {
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
  await mkdir(hlsDir, { recursive: true });

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

  await run("ffmpeg", [
    "-y",
    "-ss",
    captureAt.toFixed(2),
    "-i",
    inputPath,
    "-t",
    "6",
    "-vf",
    "scale=720:-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
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
  ]);

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

  const color = await sharp(thumbnailPath).stats();
  const dominant = color.dominant;
  const dominantColor = `#${[dominant.r, dominant.g, dominant.b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;

  await prisma.mediaAsset.update({
    where: { id: mediaId },
    data: {
      width: videoStream?.width,
      height: videoStream?.height,
      durationMs: Math.round(durationSeconds * 1000),
      frameRate: parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate),
      thumbnailPath: relativeStoragePath(thumbnailPath),
      previewPath: relativeStoragePath(previewPath),
      streamPath: relativeStoragePath(playlistPath),
      dominantColor,
      status: MediaStatus.READY
    }
  });
  await refreshPerceptualHash(mediaId, thumbnailPath);
}

export async function processMediaAsset(mediaId: string) {
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!media) return;

  const inputPath = path.resolve(storageRoot, media.originalPath);
  const outputDir = path.join(storageRoot, "derived", mediaId);
  await mkdir(outputDir, { recursive: true });

  const job = await prisma.processingJob.create({
    data: {
      mediaId,
      operation: media.kind === MediaKind.VIDEO ? "video-hls-and-preview" : "image-preview",
      state: JobState.RUNNING,
      progress: 4,
      startedAt: new Date()
    }
  });

  try {
    if (media.kind === MediaKind.VIDEO) {
      await processVideo(mediaId, inputPath, outputDir);
    } else {
      await processImage(mediaId, inputPath, outputDir);
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
