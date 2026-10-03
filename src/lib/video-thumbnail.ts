import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MediaKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const managedPath = (storagePath: string) => {
  const resolved = path.resolve(
    /* turbopackIgnore: true */ storageRoot,
    storagePath
  );
  if (resolved !== storageRoot && !resolved.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("Percorso del media non valido");
  }
  return resolved;
};

const relativeStoragePath = (absolutePath: string) =>
  path.relative(storageRoot, absolutePath).split(path.sep).join("/");

const runFfmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, {
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
      else reject(new Error(`FFmpeg thumbnail failed (${code}): ${stderr.slice(-1800)}`));
    });
  });

export async function setVideoThumbnail(mediaId: string, timestampMs: number) {
  const media = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      kind: true,
      durationMs: true,
      originalPath: true,
      thumbnailPath: true
    }
  });
  if (!media || media.kind !== MediaKind.VIDEO) throw new Error("VIDEO_NOT_FOUND");

  const boundedTimestamp = Math.max(
    0,
    Math.min(timestampMs, Math.max(0, (media.durationMs ?? timestampMs + 1) - 1))
  );
  const outputDir = path.join(storageRoot, "derived", media.id);
  const finalPath = path.join(outputDir, "thumbnail.webp");
  const temporaryPath = path.join(outputDir, `thumbnail-${Date.now()}.tmp.webp`);
  await mkdir(outputDir, { recursive: true });

  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      (boundedTimestamp / 1000).toFixed(6),
      "-i",
      managedPath(media.originalPath),
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=960:-2:force_original_aspect_ratio=decrease",
      "-c:v",
      "libwebp",
      "-quality",
      "82",
      temporaryPath
    ]);
    const color = await sharp(temporaryPath).stats();
    const dominant = color.dominant;
    const dominantColor = `#${[dominant.r, dominant.g, dominant.b]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
    await rename(temporaryPath, finalPath);
    return prisma.mediaAsset.update({
      where: { id: media.id },
      data: {
        thumbnailPath: relativeStoragePath(finalPath),
        dominantColor
      }
    });
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
