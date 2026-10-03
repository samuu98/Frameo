import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { JobState, MediaKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const storageRoot = path.resolve(process.env.STORAGE_ROOT ?? path.join(/* turbopackIgnore: true */ process.cwd(), "storage"));
const operation = "video:compatible";
const streamUrl = (storagePath: string) => `/api/stream/${storagePath.split("/").map(encodeURIComponent).join("/")}`;
const active = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

export async function getCompatibleVideo(mediaId: string) {
  const media = await prisma.mediaAsset.findUnique({ where: { id: mediaId }, select: { streamPath: true } });
  if (media?.streamPath?.endsWith("/compatible.mp4")) {
    try {
      await stat(path.join(storageRoot, media.streamPath));
      return { state: "ready", url: streamUrl(media.streamPath), progress: 100 };
    } catch { /* A missing conversion can be requested again. */ }
  }
  const job = await prisma.processingJob.findFirst({
    where: { mediaId, operation },
    orderBy: { createdAt: "desc" },
    select: { state: true, progress: true, error: true }
  });
  return { state: job?.state.toLowerCase() ?? "idle", progress: job?.progress ?? 0, error: job?.error ?? null };
}

export async function startCompatibleVideo(mediaId: string) {
  const existing = await getCompatibleVideo(mediaId);
  if (existing.state === "ready" || existing.state === "pending" || existing.state === "running") return existing;
  if (active.size >= 5) throw new Error("La coda dei video compatibili è piena. Riprova più tardi.");
  const media = await prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: { id: true, kind: true, originalPath: true, durationMs: true, bytes: true }
  });
  if (!media || media.kind !== MediaKind.VIDEO) throw new Error("Video non trovato");
  const disk = await statfs(storageRoot);
  if (BigInt(disk.bavail) * BigInt(disk.bsize) < media.bytes + 1_000_000_000n) {
    throw new Error("Spazio insufficiente per preparare il video completo.");
  }
  const job = await prisma.processingJob.create({ data: { mediaId, operation, state: JobState.PENDING, progress: 0 } });
  active.add(mediaId);
  const task = queue.then(() => convert(media, job.id));
  queue = task.catch(() => undefined);
  void task.then(() => active.delete(mediaId), () => active.delete(mediaId));
  return { state: "pending", progress: 0, error: null };
}

async function convert(media: { id: string; originalPath: string; durationMs: number | null }, jobId: string) {
  const inputPath = path.resolve(storageRoot, media.originalPath);
  if (!inputPath.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Percorso video non valido");
  const outputDir = path.join(storageRoot, "derived", media.id);
  const temporaryPath = path.join(outputDir, "compatible.tmp.mp4");
  const outputPath = path.join(outputDir, "compatible.mp4");
  try {
    await mkdir(outputDir, { recursive: true });
    await rm(temporaryPath, { force: true });
    await prisma.processingJob.update({ where: { id: jobId }, data: { state: JobState.RUNNING, startedAt: new Date(), progress: 1 } });
    let progress = 1;
    let errorTail = "";
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", [
        "-hide_banner", "-nostats", "-loglevel", "error", "-y", "-i", inputPath,
        "-map", "0:v:0", "-map", "0:a?", "-vf", "scale=1280:-2:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-threads", "1",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-progress", "pipe:1", temporaryPath
      ], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const lines = output.split(/\r?\n/);
        output = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("out_time_ms=")) continue;
          const milliseconds = Number(line.slice(12)) / 1000;
          if (media.durationMs && Number.isFinite(milliseconds)) progress = Math.max(progress, Math.min(98, Math.round(milliseconds / media.durationMs * 98)));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => { errorTail = (errorTail + chunk.toString()).slice(-1000); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(errorTail.trim() || `FFmpeg terminato con codice ${code}`)));
      const timer = setInterval(() => { void prisma.processingJob.update({ where: { id: jobId }, data: { progress } }).catch(() => undefined); }, 2000);
      child.on("close", () => clearInterval(timer));
      child.on("error", () => clearInterval(timer));
    });
    const output = await stat(temporaryPath);
    if (output.size < 1024) throw new Error("Il video convertito è vuoto.");
    await rename(temporaryPath, outputPath);
    const relativePath = `derived/${media.id}/compatible.mp4`;
    await prisma.$transaction([
      prisma.mediaAsset.update({ where: { id: media.id }, data: { streamPath: relativePath } }),
      prisma.processingJob.update({ where: { id: jobId }, data: { state: JobState.COMPLETED, progress: 100, endedAt: new Date() } })
    ]);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await prisma.processingJob.update({ where: { id: jobId }, data: { state: JobState.FAILED, error: error instanceof Error ? error.message.slice(0, 1000) : "Conversione non riuscita", endedAt: new Date() } });
    throw error;
  }
}

export async function recoverCompatibleVideoJobs() {
  await prisma.processingJob.updateMany({
    where: { operation, state: { in: [JobState.PENDING, JobState.RUNNING] } },
    data: { state: JobState.FAILED, error: "Conversione interrotta dal riavvio. Riprova dal player.", endedAt: new Date() }
  });
}
