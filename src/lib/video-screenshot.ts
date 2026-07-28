import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { MediaKind, MediaStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { processMediaAsset } from "@/lib/media-processor";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const relativeStoragePath = (absolutePath: string) =>
  path.relative(storageRoot, absolutePath).split(path.sep).join("/");

const safeBaseName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}_\- ]+/gu, "_")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 110) || "video-frame";

const hashFile = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

const runFfmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    void import("node:child_process").then(({ spawn }) => {
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
        else reject(new Error(`FFmpeg screenshot failed (${code}): ${stderr.slice(-1800)}`));
      });
    }, reject);
  });

export async function captureVideoScreenshot(
  mediaId: string,
  timestampMs: number,
  requestedTitle?: string
) {
  const source = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    include: {
      people: true,
      tags: true,
      groups: true
    }
  });
  if (!source || source.kind !== MediaKind.VIDEO) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  const boundedTimestamp = Math.max(
    0,
    Math.min(timestampMs, Math.max(0, (source.durationMs ?? timestampMs + 1) - 1))
  );
  const screenshotId = randomUUID();
  const outputDir = path.join(storageRoot, "originals", screenshotId);
  const defaultTitle = `${source.title} — frame ${Math.round(boundedTimestamp)}ms`;
  const title = requestedTitle?.trim() || defaultTitle;
  const outputPath = path.join(outputDir, `${safeBaseName(title)}.png`);
  const inputPath = path.resolve(storageRoot, source.originalPath);
  await mkdir(outputDir, { recursive: true });

  try {
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-ss",
      (boundedTimestamp / 1000).toFixed(6),
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-fps_mode",
      "passthrough",
      outputPath
    ]);
    const [fileStats, contentHash] = await Promise.all([
      stat(outputPath),
      hashFile(outputPath)
    ]);
    await prisma.mediaAsset.create({
      data: {
        id: screenshotId,
        title,
        kind: MediaKind.IMAGE,
        status: MediaStatus.PROCESSING,
        mimeType: "image/png",
        bytes: BigInt(fileStats.size),
        capturedAt: source.capturedAt
          ? new Date(source.capturedAt.getTime() + boundedTimestamp)
          : new Date(),
        sourceMediaId: source.id,
        sourceTimeMs: boundedTimestamp,
        originalPath: relativeStoragePath(outputPath),
        sourceFileName: path.basename(outputPath),
        contentHash,
        directoryKey: `originals/${screenshotId}`,
        people: {
          create: source.people.map(({ personId, confidence, region }) => ({
            personId,
            confidence,
            region: region ?? undefined
          }))
        },
        tags: {
          create: source.tags.map(({ tagId }) => ({ tagId }))
        },
        groups: {
          create: source.groups.map(({ groupId, sortOrder }) => ({
            groupId,
            sortOrder
          }))
        }
      }
    });
  } catch (error) {
    await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  await processMediaAsset(screenshotId).catch((error) => {
    console.error(`Screenshot processing failed for media ${screenshotId}`, error);
  });
  return screenshotId;
}
