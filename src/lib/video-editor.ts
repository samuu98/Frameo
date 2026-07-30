import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
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

const run = async (command: string, args: string[]) => {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
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
  transcode = false
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
    ...common,
    ...codecArgs,
    "-movflags",
    "+faststart",
    outputPath
  ]);
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
      const clips: string[] = [];
      for (const [index, segment] of project.segments.entries()) {
        const clipPath = path.join(outputDir, `clip-${String(index).padStart(3, "0")}.mp4`);
        await renderSegment(
          path.resolve(storageRoot, segment.media.originalPath),
          clipPath,
          segment.startMs,
          segment.endMs,
          true
        );
        clips.push(clipPath);
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
      const outputPath = path.join(outputDir, `${outputBase}.mp4`);
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
    throw error;
  }
}
