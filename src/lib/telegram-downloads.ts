import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { open, mkdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { DownloadSource, DownloadState } from "@prisma/client";
import { importDownloadedMedia } from "@/lib/import-downloaded-media";
import { libraryPaths } from "@/lib/library-settings";
import { prisma } from "@/lib/prisma";

interface SavedTelegramSession {
  apiId: number;
  apiHash: string;
  session: string;
}

interface PendingLogin {
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash: string;
}

const sessionPath = path.join(libraryPaths.storageRoot, "private", "telegram-session.json");
const telethonSessionPath = path.join(libraryPaths.storageRoot, "private", "telegram-telethon.session");
const pendingLoginPath = path.join(libraryPaths.storageRoot, "private", "telegram-login-pending.json");
const temporaryRoot = path.join(libraryPaths.storageRoot, "downloads");

const runTelethonAuth = (action: "request-code" | "verify", payload: unknown) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn("/opt/telegram-auth/bin/python", [path.join(process.cwd(), "scripts", "telegram_auth.py"), action], {
      env: { ...process.env, STORAGE_ROOT: libraryPaths.storageRoot },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      let result: Record<string, unknown>;
      try {
        result = JSON.parse(stdout.trim()) as Record<string, unknown>;
      } catch {
        reject(new Error(stderr.trim() || "Risposta Telethon non valida"));
        return;
      }
      if (code === 0 && !result.error) resolve(result);
      else reject(new Error(String(result.error ?? stderr.trim() ?? "Accesso Telegram non riuscito")));
    });
    child.stdin.end(JSON.stringify(payload));
  });

const serializeJob = (job: {
  downloadedBytes: bigint;
  totalBytes: bigint;
  speedBps: bigint;
  [key: string]: unknown;
}) => ({
  ...job,
  downloadedBytes: job.downloadedBytes.toString(),
  totalBytes: job.totalBytes.toString(),
  speedBps: job.speedBps.toString()
});

const friendlyError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const upper = message.toUpperCase();
  if (upper.includes("SESSION_PASSWORD_NEEDED")) return "È richiesta la password di verifica in due passaggi.";
  if (upper.includes("PHONE_CODE_INVALID")) return "Il codice Telegram non è valido.";
  if (upper.includes("PHONE_CODE_EXPIRED")) return "Il codice Telegram è scaduto. Richiedine uno nuovo.";
  if (upper.includes("CHANNEL_PRIVATE")) return "L'account Telegram non può accedere a questo canale privato.";
  if (upper.includes("MESSAGE_ID_INVALID")) return "Il messaggio Telegram non esiste o non è accessibile.";
  return message.slice(0, 1200);
};

class TelegramDownloadManager {
  private client: TelegramClient | null = null;
  private credentials: Pick<SavedTelegramSession, "apiId" | "apiHash"> | null = null;
  private pendingLogin: PendingLogin | null = null;
  private connecting: Promise<boolean> | null = null;
  private workerStarted = false;
  private workerRunning = false;
  private stopped = false;
  private dialogsLoaded = false;

  async status() {
    const connected = await this.ensureConnected();
    if (!connected || !this.client) {
      const loginPending = Boolean(this.pendingLogin) || await stat(pendingLoginPath).then(() => true).catch(() => false);
      return { connected: false, loginPending };
    }
    const me = await this.client.getMe();
    return {
      connected: true,
      loginPending: false,
      user: {
        id: me.id.toString(),
        username: me.username ?? null,
        firstName: me.firstName ?? null,
        lastName: me.lastName ?? null,
        phone: me.phone ? `••••${me.phone.slice(-4)}` : null
      }
    };
  }

  private async readSession(): Promise<SavedTelegramSession | null> {
    try {
      const value = JSON.parse(await readFile(sessionPath, "utf8")) as SavedTelegramSession;
      if (!Number.isInteger(value.apiId) || !value.apiHash || !value.session) return null;
      return value;
    } catch {
      return null;
    }
  }

  private async ensureConnected() {
    if (this.client?.connected && await this.client.checkAuthorization().catch(() => false)) return true;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const saved = await this.readSession();
      if (!saved) return false;
      try {
        if (this.client) await this.client.disconnect().catch(() => undefined);
        this.client = new TelegramClient(new StringSession(saved.session), saved.apiId, saved.apiHash, {
          connectionRetries: 5
        });
        this.credentials = { apiId: saved.apiId, apiHash: saved.apiHash };
        await this.client.connect();
        this.dialogsLoaded = false;
        return await this.client.checkAuthorization();
      } catch (error) {
        console.error("Telegram reconnect failed", error);
        return false;
      }
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async requestCode(apiId: number, apiHash: string, phone: string) {
    if (this.client) await this.client.disconnect().catch(() => undefined);
    this.client = null;
    this.credentials = null;
    const result = await runTelethonAuth("request-code", { apiId, apiHash, phone });
    if (result.authorized) {
      await this.ensureConnected();
      this.startWorker();
      return result;
    }
    this.pendingLogin = { apiId, apiHash, phone, phoneCodeHash: "telethon" };
    return result;
  }

  async verify(code: string, password?: string) {
    if (!this.pendingLogin && !await stat(pendingLoginPath).then(() => true).catch(() => false)) {
      throw new Error("Nessun accesso Telegram in corso.");
    }
    const result = await runTelethonAuth("verify", { code, password });
    if (result.passwordRequired) return result;
    this.pendingLogin = null;
    this.dialogsLoaded = false;
    if (!await this.ensureConnected()) throw new Error("Sessione Telegram creata ma connessione non riuscita.");
    this.startWorker();
    return result;
  }

  async disconnect(forget = false) {
    if (this.client) {
      if (forget) await this.client.logOut().catch(() => undefined);
      await this.client.disconnect().catch(() => undefined);
    }
    this.client = null;
    this.credentials = null;
    this.pendingLogin = null;
    this.dialogsLoaded = false;
    if (forget) {
      await Promise.all([
        unlink(sessionPath).catch(() => undefined),
        unlink(telethonSessionPath).catch(() => undefined),
        unlink(`${telethonSessionPath}-journal`).catch(() => undefined),
        unlink(pendingLoginPath).catch(() => undefined)
      ]);
    }
  }

  parseLink(sourceUrl: string) {
    let url: URL;
    try {
      url = new URL(sourceUrl.trim());
    } catch {
      throw new Error("Incolla un link Telegram completo, per esempio https://t.me/c/123/456.");
    }
    if (!["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(url.hostname.toLowerCase())) {
      throw new Error("Questo campo accetta soltanto link t.me di messaggi Telegram.");
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const offset = parts[0] === "s" ? 1 : 0;
    const finalPart = parts.at(-1) ?? "";
    if (parts[offset] === "c" && /^\d+$/.test(parts[offset + 1] ?? "") && /^\d+$/.test(finalPart)) {
      return { entity: Number(`-100${parts[offset + 1]}`), messageId: Number(finalPart) };
    }
    if (/^[A-Za-z\d_]+$/.test(parts[offset] ?? "") && /^\d+$/.test(finalPart) && parts.length - offset >= 2) {
      return { entity: parts[offset], messageId: Number(finalPart) };
    }
    throw new Error("Il link deve puntare a un singolo messaggio Telegram contenente un video.");
  }

  async enqueue(sourceUrl: string) {
    if (!await this.ensureConnected()) throw new Error("Collega prima il tuo account Telegram.");
    const parsed = this.parseLink(sourceUrl);
    const sourceKey = `${String(parsed.entity).toLowerCase()}:${parsed.messageId}`;
    const existing = await prisma.downloadJob.findUnique({
      where: { source_sourceKey: { source: DownloadSource.TELEGRAM, sourceKey } }
    });
    if (existing && existing.state !== DownloadState.FAILED && existing.state !== DownloadState.CANCELED) {
      return serializeJob(existing);
    }
    const job = existing
      ? await prisma.downloadJob.update({
          where: { id: existing.id },
          data: { sourceUrl, state: DownloadState.PENDING, progress: 0, error: null, completedAt: null }
        })
      : await prisma.downloadJob.create({
          data: { source: DownloadSource.TELEGRAM, sourceUrl, sourceKey }
        });
    this.startWorker();
    return serializeJob(job);
  }

  async retry(id: string) {
    const job = await prisma.downloadJob.findUnique({ where: { id } });
    if (!job || job.source !== DownloadSource.TELEGRAM) throw new Error("Download Telegram non trovato.");
    if (job.state !== DownloadState.FAILED && job.state !== DownloadState.CANCELED) return serializeJob(job);
    const updated = await prisma.downloadJob.update({
      where: { id },
      data: { state: DownloadState.PENDING, error: null, completedAt: null }
    });
    this.startWorker();
    return serializeJob(updated);
  }

  async listJobs() {
    const jobs = await prisma.downloadJob.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return jobs.map(serializeJob);
  }

  startWorker() {
    if (this.workerStarted) return;
    this.workerStarted = true;
    this.stopped = false;
    void prisma.downloadJob.updateMany({
      where: { source: DownloadSource.TELEGRAM, state: DownloadState.DOWNLOADING },
      data: { state: DownloadState.PENDING, error: "Download ripreso dopo il riavvio." }
    }).finally(() => this.runWorker());
  }

  private async runWorker() {
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      while (!this.stopped) {
        if (!await this.ensureConnected()) break;
        const next = await prisma.downloadJob.findFirst({
          where: { state: DownloadState.PENDING, source: DownloadSource.TELEGRAM },
          orderBy: { createdAt: "asc" }
        });
        if (!next) break;
        await this.download(next.id).catch(() => undefined);
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
      if (!this.client || !await this.ensureConnected()) throw new Error("Telegram non connesso.");
      const parsed = this.parseLink(job.sourceUrl);
      // I link t.me/c contengono soltanto l'id interno. Caricando i dialoghi
      // ricostruiamo l'access hash dei canali privati visibili all'account.
      if (typeof parsed.entity === "number" && !this.dialogsLoaded) {
        await this.client.getDialogs({ limit: 1000 });
        this.dialogsLoaded = true;
      }
      const messages = await this.client.getMessages(parsed.entity, { ids: parsed.messageId });
      const message = messages[0];
      if (!message || !message.file || !message.media) throw new Error("Il messaggio Telegram non contiene un file scaricabile.");

      const mimeType = message.file.mimeType ?? (message.video ? "video/mp4" : message.photo ? "image/jpeg" : "application/octet-stream");
      const fallbackExtension = mimeType.startsWith("video/") ? ".mp4" : mimeType.startsWith("image/") ? ".jpg" : "";
      const fileName = path.basename(message.file.name || `telegram_${message.id}${fallbackExtension}`)
        .replace(/[^\w.\-() ]+/g, "_");
      const total = BigInt(message.file.size?.toString() ?? "0");
      const jobDirectory = path.join(temporaryRoot, id);
      const partialPath = path.join(jobDirectory, `${randomUUID()}.part`);
      await mkdir(jobDirectory, { recursive: true });

      const previousPath = job.targetPath && job.targetPath.endsWith(".part") ? job.targetPath : null;
      const activePartial = previousPath && await stat(previousPath).then(() => true).catch(() => false)
        ? previousPath
        : partialPath;
      let downloaded = BigInt(await stat(activePartial).then((value) => value.size).catch(() => 0));
      const output = await open(activePartial, downloaded ? "a" : "w");
      await prisma.downloadJob.update({
        where: { id },
        data: { fileName, targetPath: activePartial, totalBytes: total, downloadedBytes: downloaded }
      });

      let lastPersisted = Date.now();
      let lastBytes = downloaded;
      let lastTime = Date.now();
      try {
        for await (const chunk of this.client.iterDownload(message, { offset: Number(downloaded) })) {
          await output.write(chunk);
          downloaded += BigInt(chunk.length);
          const now = Date.now();
          if (now - lastPersisted >= 500 || (total && downloaded >= total)) {
            const seconds = Math.max(0.001, (now - lastTime) / 1000);
            const speed = BigInt(Math.max(0, Math.round(Number(downloaded - lastBytes) / seconds)));
            const eta = total > downloaded && speed > 0 ? Number((total - downloaded) / speed) : null;
            const progress = total > 0 ? Math.min(99, Math.round(Number(downloaded * 100n / total))) : 0;
            await prisma.downloadJob.update({
              where: { id },
              data: { downloadedBytes: downloaded, totalBytes: total, speedBps: speed, etaSeconds: eta, progress }
            });
            lastPersisted = now;
            lastTime = now;
            lastBytes = downloaded;
          }
        }
      } finally {
        await output.sync();
        await output.close();
      }
      if (total > 0 && downloaded !== total) throw new Error(`Download incompleto: ${downloaded} byte su ${total}.`);

      await prisma.downloadJob.update({ where: { id }, data: { state: DownloadState.PROCESSING, progress: 100 } });
      const media = await importDownloadedMedia(activePartial, fileName);
      await prisma.downloadJob.update({
        where: { id },
        data: {
          state: DownloadState.COMPLETED,
          mediaId: media.id,
          targetPath: media.originalPath,
          downloadedBytes: downloaded,
          totalBytes: total || downloaded,
          speedBps: 0,
          etaSeconds: 0,
          progress: 100,
          completedAt: new Date(),
          error: null
        }
      });
    } catch (error) {
      await prisma.downloadJob.update({
        where: { id },
        data: { state: DownloadState.FAILED, speedBps: 0, etaSeconds: null, error: friendlyError(error), completedAt: new Date() }
      });
      throw error;
    }
  }
}

const globalTelegram = globalThis as unknown as { telegramDownloads?: TelegramDownloadManager };
export const telegramDownloads = globalTelegram.telegramDownloads ?? new TelegramDownloadManager();
if (process.env.NODE_ENV !== "production") globalTelegram.telegramDownloads = telegramDownloads;
export { friendlyError, serializeJob };
