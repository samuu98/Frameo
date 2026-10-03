import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EditOperation,
  JobState,
  MediaKind,
  MediaStatus
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processMediaAsset } from "@/lib/media-processor";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const relativeStoragePath = (absolutePath: string) =>
  path.relative(storageRoot, absolutePath).split(path.sep).join("/");

const run = async (
  command: string,
  args: string[],
  onProgress?: (milliseconds: number) => void
) => {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    let progressBuffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = `${stderr}${text}`.slice(-16_000);
      if (onProgress) {
        progressBuffer += text;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const match = line.match(/^out_time_(?:us|ms)=(\d+)$/);
          if (match) onProgress(Number(match[1]) / 1000);
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with ${code}: ${stderr.slice(-2400)}`));
    });
  });
};

const hashFile = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const safeBaseName = (value: string) =>
  path
    .basename(value, path.extname(value))
    .replace(/[^\p{L}\p{N}_\- ]+/gu, "_")
    .trim()
    .slice(0, 120) || "frameo-edit";

async function renderSegment(
  inputPath: string,
  outputPath: string,
  startMs: number,
  endMs: number,
  transcode = false,
  onProgress?: (milliseconds: number) => void
) {
  const common = [
    "-y",
    "-ss",
    (startMs / 1000).toFixed(3),
    "-i",
    inputPath,
    "-t",
    ((endMs - startMs) / 1000).toFixed(3)
  ];
  const codecArgs = transcode
    ? [
        "-vf",
        "scale=1280:-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-threads",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "128k"
      ]
    : ["-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-avoid_negative_ts", "make_zero"];
  await run("ffmpeg", [
    "-progress",
    "pipe:2",
    "-nostats",
    ...common,
    ...codecArgs,
    "-movflags",
    "+faststart",
    outputPath
  ], onProgress);
}

interface StreamSignature {
  video: string;
  audio: string;
}

const fraction = (value?: string) => {
  const [numerator, denominator] = (value ?? "0/1").split("/").map(Number);
  return denominator ? numerator / denominator : 0;
};

async function streamSignature(inputPath: string): Promise<StreamSignature | null> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,profile,level,codec_tag_string,width,height,pix_fmt,r_frame_rate,sample_fmt,sample_rate,channels,channel_layout",
      "-of", "json",
      inputPath
    ], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      try {
        const streams = JSON.parse(stdout).streams as Array<Record<string, string | number>>;
        const video = streams.find(({ codec_type }) => codec_type === "video");
        const audio = streams.find(({ codec_type }) => codec_type === "audio");
        if (!video) return resolve(null);
        resolve({
          video: [video.codec_name, video.profile, video.level, video.codec_tag_string, video.width, video.height, video.pix_fmt, fraction(String(video.r_frame_rate)).toFixed(3)].join("|"),
          audio: audio ? [audio.codec_name, audio.profile, audio.sample_fmt, audio.sample_rate, audio.channels, audio.channel_layout].join("|") : "none"
        });
      } catch {
        resolve(null);
      }
    });
  });
}

async function createOutputMedia(
  projectId: string,
  outputPath: string,
  title: string
) {
  const fileStat = await stat(outputPath);
  const contentHash = await hashFile(outputPath);
  const media = await prisma.mediaAsset.create({
    data: {
      id: randomUUID(),
      title,
      kind: MediaKind.VIDEO,
      status: MediaStatus.PROCESSING,
      mimeType: "video/mp4",
      bytes: BigInt(fileStat.size),
      originalPath: relativeStoragePath(outputPath),
      sourceFileName: path.basename(outputPath),
      contentHash,
      directoryKey: `edited/${projectId}`
    }
  });
  void processMediaAsset(media.id).catch((error) => {
    console.error(`Processing edited media ${media.id} failed`, error);
  });
  return media;
}

export async function executeEditProject(projectId: string) {
  const project = await prisma.editProject.findUnique({
    where: { id: projectId },
    include: {
      segments: {
        include: { media: true },
        orderBy: { sortOrder: "asc" }
      }
    }
  });
  if (!project || !project.segments.length) return;

  const outputDir = path.join(storageRoot, "edited", project.id);
  await mkdir(outputDir, { recursive: true });
  await prisma.editProject.update({
    where: { id: project.id },
    data: { state: JobState.RUNNING, progress: 5 }
  });

  try {
    const outputBase = safeBaseName(project.outputFileName ?? project.name);
    const outputs: Array<{ path: string; title: string }> = [];

    if (project.operation === EditOperation.SPLIT) {
      for (const [index, segment] of project.segments.entries()) {
        const outputPath = path.join(
          outputDir,
          `${outputBase}-${String(index + 1).padStart(2, "0")}.mp4`
        );
        await renderSegment(
          path.resolve(storageRoot, segment.media.originalPath),
          outputPath,
          segment.startMs,
          segment.endMs
        );
        outputs.push({ path: outputPath, title: `${project.name} · ${index + 1}` });
        await prisma.editProject.update({
          where: { id: project.id },
          data: { progress: Math.round(((index + 1) / project.segments.length) * 78) }
        });
      }
    } else if (project.operation === EditOperation.TRIM) {
      const segment = project.segments[0];
      const outputPath = path.join(outputDir, `${outputBase}.mp4`);
      await renderSegment(
        path.resolve(storageRoot, segment.media.originalPath),
        outputPath,
        segment.startMs,
        segment.endMs
      );
      outputs.push({ path: outputPath, title: project.name });
    } else {
      const totalDuration = project.segments.reduce(
        (total, segment) => total + (segment.endMs - segment.startMs),
        0
      );
      const fullInputs = project.segments.every((segment) =>
        segment.startMs === 0 &&
        Boolean(segment.media.durationMs) &&
        Math.abs(segment.endMs - (segment.media.durationMs ?? 0)) <= 250
      );
      const inputPaths = project.segments.map((segment) =>
        path.resolve(storageRoot, segment.media.originalPath)
      );
      const signatures = fullInputs
        ? await Promise.all(inputPaths.map(streamSignature))
        : [];
      const fastMerge = fullInputs &&
        signatures.length > 0 &&
        signatures.every((signature) =>
          signature &&
          signature.video === signatures[0]?.video &&
          signature.audio === signatures[0]?.audio
        );
      const outputPath = path.join(outputDir, `${outputBase}.mp4`);
      if (fastMerge) {
        const clips: string[] = [];
        let completedDuration = 0;
        for (const [index, inputPath] of inputPaths.entries()) {
          const clipPath = path.join(outputDir, `normalized-${String(index).padStart(3, "0")}.mp4`);
          const segmentDuration = project.segments[index].endMs - project.segments[index].startMs;
          await run("ffmpeg", [
            "-progress", "pipe:2", "-nostats", "-y", "-i", inputPath,
            "-map", "0:v:0", "-map", "0:a?", "-c", "copy",
            "-video_track_timescale", "90000", "-avoid_negative_ts", "make_zero",
            "-movflags", "+faststart", clipPath
          ], (milliseconds) => {
            const progress = 5 + Math.round(
              ((completedDuration + Math.min(milliseconds, segmentDuration)) / totalDuration) * 45
            );
            void prisma.editProject.update({ where: { id: project.id }, data: { progress } }).catch(() => undefined);
          });
          clips.push(clipPath);
          completedDuration += segmentDuration;
        }
        const concatList = path.join(outputDir, "concat.txt");
        await writeFile(
          concatList,
          clips.map((clip) => `file '${clip.replaceAll("'", "'\\''")}'`).join("\n"),
          "utf8"
        );
        await prisma.editProject.update({ where: { id: project.id }, data: { progress: 52 } });
        await run("ffmpeg", [
          "-progress", "pipe:2", "-nostats", "-y", "-f", "concat", "-safe", "0",
          "-i", concatList, "-c", "copy", "-movflags", "+faststart", outputPath
        ], (milliseconds) => {
          const progress = 52 + Math.round(Math.min(1, milliseconds / totalDuration) * 26);
          void prisma.editProject.update({ where: { id: project.id }, data: { progress } }).catch(() => undefined);
        });
        await rm(concatList, { force: true });
        await Promise.all(clips.map((clip) => rm(clip, { force: true })));
      } else {
      const clips: string[] = [];
      let completedDuration = 0;
      let lastProgressUpdate = 0;
      for (const [index, segment] of project.segments.entries()) {
        const clipPath = path.join(outputDir, `clip-${String(index).padStart(3, "0")}.mp4`);
        const segmentDuration = segment.endMs - segment.startMs;
        await renderSegment(
          path.resolve(storageRoot, segment.media.originalPath),
          clipPath,
          segment.startMs,
          segment.endMs,
          true,
          (milliseconds) => {
            const now = Date.now();
            if (now - lastProgressUpdate < 2000) return;
            lastProgressUpdate = now;
            const progress = Math.max(5, Math.round(
              ((completedDuration + Math.min(milliseconds, segmentDuration)) / totalDuration) * 65
            ));
            void prisma.editProject.update({ where: { id: project.id }, data: { progress } }).catch(() => undefined);
          }
        );
        clips.push(clipPath);
        completedDuration += segmentDuration;
        await prisma.editProject.update({
          where: { id: project.id },
          data: { progress: Math.round(((index + 1) / project.segments.length) * 65) }
        });
      }
      const concatList = path.join(outputDir, "concat.txt");
      await writeFile(
        concatList,
        clips.map((clip) => `file '${clip.replaceAll("'", "'\\''")}'`).join("\n"),
        "utf8"
      );
      await run("ffmpeg", [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatList,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputPath
      ]);
      await Promise.all([
        ...clips.map((clip) => rm(clip, { force: true })),
        rm(concatList, { force: true })
      ]);
      }
      outputs.push({ path: outputPath, title: project.name });
    }

    const mediaOutputs = [];
    for (const output of outputs) {
      mediaOutputs.push(
        await createOutputMedia(project.id, output.path, output.title)
      );
    }
    await prisma.editProject.update({
      where: { id: project.id },
      data: {
        state: JobState.COMPLETED,
        progress: 100,
        outputMediaId: mediaOutputs[0]?.id
      }
    });
  } catch (error) {
    await prisma.editProject.update({
      where: { id: project.id },
      data: {
        state: JobState.FAILED,
        error: error instanceof Error ? error.message.slice(0, 4000) : "Editing failed"
      }
    });
    const referencedOutputs = await prisma.mediaAsset.count({
      where: { directoryKey: `edited/${project.id}` }
    });
    if (!referencedOutputs) {
      await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}
