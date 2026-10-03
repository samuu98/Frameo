import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { DownloadSource, DownloadState } from "@prisma/client";
import { importDownloadedMedia } from "@/lib/import-downloaded-media";
import { libraryPaths } from "@/lib/library-settings";
import { prisma } from "@/lib/prisma";
import { friendlyError, serializeJob } from "@/lib/telegram-downloads";

type Event = {
  type: "metadata" | "progress" | "complete" | "error";
  downloadedBytes?: number;
  totalBytes?: number;
  speedBps?: number;
  etaSeconds?: number | null;
  filePath?: string;
  fileName?: string;
  bytes?: number;
  message?: string;
};

const maximumBytes = Number(process.env.MAX_UPLOAD_BYTES || 5368709120);
const bunkrAlbum = /^https:\/\/(?:www\.)?bunkr\.pk\/a\/[A-Za-z0-9_-]+\/?$/i;
const bunkrFile = /^https:\/\/(?:www\.)?bunkr\.pk\/f\/[A-Za-z0-9_-]+\/?$/i;

const discoverBunkrAlbum = (sourceUrl: string) => new Promise<string[]>((resolve, reject) => {
  const child = spawn("/opt/telegram-auth/bin/python", [path.join(process.cwd(), "scripts", "bunkr_download.py")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { NODE_ENV: "production", PATH: process.env.PATH || "/usr/bin:/bin", HOME: "/tmp" }
  });
  let output = "";
  let errorOutput = "";
  const timeout = setTimeout(() => child.kill(), 35000);
  child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-20000); });
  child.stderr.on("data", (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString()).slice(-1200); });
  child.once("error", (error) => { clearTimeout(timeout); reject(error); });
  child.once("close", (code) => {
    clearTimeout(timeout);
    try {
      const result = JSON.parse(output.trim()) as { type: string; urls?: string[]; message?: string };
      if (code !== 0 || result.type !== "discovery" || !result.urls?.length) {
        reject(new Error(result.message || errorOutput || "Impossibile leggere l'album Bunkr."));
      } else {
        resolve(result.urls.filter((url) => bunkrFile.test(url)));
      }
    } catch { reject(new Error(errorOutput || "Risposta Bunkr non valida.")); }
  });
  child.stdin.end(JSON.stringify({ action: "discover", url: sourceUrl }));
});

function parseWebUrl(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Incolla l'indirizzo completo di una pagina web."); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("Inserisci un URL pubblico HTTP o HTTPS senza credenziali incorporate.");
  }
  url.hash = "";
  return url.toString();
}

class WebDownloadManager {
  private workerStarted = false;
  private workerRunning = false;

  async enqueue(input: string) {
    const sourceUrl = parseWebUrl(input);
    const urls = bunkrAlbum.test(sourceUrl) ? await discoverBunkrAlbum(sourceUrl) : [sourceUrl];
    if (!urls.length) throw new Error("Nessun video trovato nell'album Bunkr.");
    let firstJob;
    for (const itemUrl of urls) {
      const sourceKey = createHash("sha256").update(itemUrl).digest("hex");
      const existing = await prisma.downloadJob.findUnique({
        where: { source_sourceKey: { source: DownloadSource.WEB, sourceKey } }
      });
      const job = existing && existing.state !== DownloadState.FAILED && existing.state !== DownloadState.CANCELED
        ? existing
        : existing
          ? await prisma.downloadJob.update({
              where: { id: existing.id },
              data: { state: DownloadState.PENDING, sourceUrl: itemUrl, progress: 0, downloadedBytes: 0,
                totalBytes: 0, speedBps: 0, etaSeconds: null, error: null, completedAt: null }
            })
          : await prisma.downloadJob.create({ data: { source: DownloadSource.WEB, sourceUrl: itemUrl, sourceKey } });
      firstJob ??= job;
    }
    this.startWorker();
    return serializeJob(firstJob!);
  }

  async retry(id: string) {
    const job = await prisma.downloadJob.findUnique({ where: { id } });
    if (!job || job.source !== DownloadSource.WEB) throw new Error("Download web non trovato.");
    if (job.state !== DownloadState.FAILED && job.state !== DownloadState.CANCELED) return serializeJob(job);
    const updated = await prisma.downloadJob.update({
      where: { id }, data: { state: DownloadState.PENDING, error: null, completedAt: null, progress: 0 }
    });
    this.startWorker();
    return serializeJob(updated);
  }

  startWorker() {
    if (this.workerStarted) return;
    this.workerStarted = true;
    void prisma.downloadJob.updateMany({
      where: { source: DownloadSource.WEB, state: { in: [DownloadState.DOWNLOADING, DownloadState.PROCESSING] } },
      data: { state: DownloadState.PENDING, error: "Download ripreso dopo il riavvio." }
    }).then(() => this.runWorker()).catch((error) => {
      this.workerStarted = false;
      console.error("Web download worker startup failed", error);
    });
  }

  private async runWorker() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (true) {
        const next = await prisma.downloadJob.findFirst({
          where: { source: DownloadSource.WEB, state: DownloadState.PENDING }, orderBy: { createdAt: "asc" }
        });
        if (!next) break;
        await this.download(next.id).catch((error) => console.error("Web download failed", next.id, error));
      }
    } finally {
      this.workerRunning = false;
      this.workerStarted = false;
    }
  }

  private async download(id: string) {
    const job = await prisma.downloadJob.update({
      where: { id },
      data: { state: DownloadState.DOWNLOADING, attempts: { increment: 1 }, startedAt: new Date(), error: null }
    });
    try {
      const directory = path.join(libraryPaths.storageRoot, "downloads", id);
      await mkdir(directory, { recursive: true });
      const gofile = /^https:\/\/(?:www\.)?gofile\.io\/d\//i.test(job.sourceUrl);
      const bunkr = bunkrFile.test(job.sourceUrl);
      const child = bunkr
        ? spawn("/opt/telegram-auth/bin/python", [path.join(process.cwd(), "scripts", "bunkr_download.py")], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { NODE_ENV: "production", PATH: process.env.PATH || "/usr/bin:/bin", HOME: "/tmp" }
          })
        : gofile
        ? spawn(process.execPath, [path.join(process.cwd(), "scripts", "gofile_download.mjs")], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { NODE_ENV: "production", PATH: process.env.PATH || "/usr/bin:/bin",
              HOME: "/tmp", CHROMIUM_PATH: "/usr/bin/chromium-browser" }
          })
        : spawn("/opt/telegram-auth/bin/python", [path.join(process.cwd(), "scripts", "web_download.py")], {
            stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" }
          });
      child.stdin.end(JSON.stringify({ url: job.sourceUrl, directory, maxBytes: maximumBytes }));
      let completion: Event | null = null;
      let errorMessage = "";
      let stderr = "";
      let lastUpdate = 0;
      child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-1600); });
      const exit = new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? 1));
      });
      for await (const line of createInterface({ input: child.stdout })) {
        let event: Event;
        try { event = JSON.parse(line) as Event; } catch { continue; }
        if (event.type === "error") errorMessage = event.message || "Download non riuscito.";
        if (event.type === "complete") completion = event;
        if (event.type === "metadata" && event.fileName) {
          await prisma.downloadJob.update({ where: { id }, data: {
            fileName: path.basename(event.fileName), totalBytes: Math.max(0, Math.floor(event.totalBytes || 0))
          } });
        }
        if (event.type === "progress" && Date.now() - lastUpdate >= 500) {
          const downloaded = Math.max(0, Math.floor(event.downloadedBytes || 0));
          const total = Math.max(0, Math.floor(event.totalBytes || 0));
          await prisma.downloadJob.update({
            where: { id }, data: {
              downloadedBytes: downloaded, totalBytes: total, speedBps: Math.max(0, Math.floor(event.speedBps || 0)),
              etaSeconds: Number.isFinite(event.etaSeconds) ? Math.max(0, Math.floor(event.etaSeconds!)) : null,
              progress: total ? Math.min(99, Math.round(downloaded / total * 100)) : 0
            }
          });
          lastUpdate = Date.now();
        }
      }
      const code = await exit;
      if (code !== 0 || !completion?.filePath || !completion.fileName) {
        throw new Error(errorMessage || stderr.trim() || "Il video non è scaricabile da questa pagina.");
      }
      const filePath = path.resolve(completion.filePath);
      if (!filePath.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error("Percorso del download non valido.");
      const details = await stat(filePath);
      if (!details.isFile() || details.size > maximumBytes) throw new Error("Il file video supera il limite consentito.");
      await prisma.downloadJob.update({
        where: { id }, data: { state: DownloadState.PROCESSING, progress: 100,
          fileName: path.basename(completion.fileName), targetPath: filePath,
          downloadedBytes: details.size, totalBytes: details.size, speedBps: 0, etaSeconds: 0 }
      });
      const media = await importDownloadedMedia(filePath, completion.fileName);
      await prisma.downloadJob.update({
        where: { id }, data: { state: DownloadState.COMPLETED, mediaId: media.id,
          targetPath: media.originalPath, completedAt: new Date(), error: null }
      });
    } catch (error) {
      await prisma.downloadJob.update({ where: { id }, data: {
        state: DownloadState.FAILED, speedBps: 0, etaSeconds: null,
        error: friendlyError(error), completedAt: new Date()
      } });
      throw error;
    }
  }
}

const globalWeb = globalThis as unknown as { webDownloads?: WebDownloadManager };
export const webDownloads = globalWeb.webDownloads ?? new WebDownloadManager();
if (process.env.NODE_ENV !== "production") globalWeb.webDownloads = webDownloads;
