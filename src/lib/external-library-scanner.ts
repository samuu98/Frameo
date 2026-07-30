import { randomUUID } from "node:crypto";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { MediaKind, MediaStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getLibrarySettings,
  libraryPaths
} from "@/lib/library-settings";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const imageTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp"
};

const videoTypes: Record<string, string> = {
  ".3gp": "video/3gpp",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv"
};

export interface ExternalScanStatus {
  configured: boolean;
  running: boolean;
  discovered: number;
  supported: number;
  added: number;
  skipped: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const globalScanner = globalThis as unknown as {
  frameoExternalScan?: ExternalScanStatus;
  frameoExternalScanPromise?: Promise<void>;
};

const initialStatus = (): ExternalScanStatus => ({
  configured: Boolean(process.env.EXTERNAL_MEDIA_ROOT),
  running: false,
  discovered: 0,
  supported: 0,
  added: 0,
  skipped: 0,
  error: null,
  startedAt: null,
  completedAt: null
});

const scanStatus =
  globalScanner.frameoExternalScan ??
  (globalScanner.frameoExternalScan = initialStatus());

const toPosix = (value: string) => value.split(path.sep).join("/");

async function flushBatch(batch: Prisma.MediaAssetCreateManyInput[]) {
  if (!batch.length) return;
  const result = await prisma.mediaAsset.createMany({
    data: batch
  });
  scanStatus.added += result.count;
  scanStatus.skipped += batch.length - result.count;
  batch.length = 0;
}

async function scanExternalLibrary() {
  const configuredRoot = process.env.EXTERNAL_MEDIA_ROOT;
  if (!configuredRoot) return;

  const externalRoot = path.resolve(configuredRoot);
  const storagePrefix = `${storageRoot}${path.sep}`;
  if (!externalRoot.startsWith(storagePrefix)) {
    throw new Error("La libreria esterna deve essere montata dentro STORAGE_ROOT.");
  }

  const rootStat = await stat(externalRoot);
  if (!rootStat.isDirectory()) {
    throw new Error("La libreria esterna configurata non è una directory.");
  }

  const directoryKey = process.env.EXTERNAL_MEDIA_KEY?.trim() || "external-library";
  const storageRelativeRoot = toPosix(path.relative(storageRoot, externalRoot));
  const settings = await getLibrarySettings();
  const existingPaths = new Set(
    (
      await prisma.mediaAsset.findMany({
        where: { directoryKey },
        select: { originalPath: true }
      })
    ).map(({ originalPath }) => originalPath)
  );
  const batch: Prisma.MediaAssetCreateManyInput[] = [];
  const scanFolders = [...new Set(settings.scanFolders)]
    .sort((left, right) => left.length - right.length)
    .filter(
      (folder, index, all) =>
        !all
          .slice(0, index)
          .some(
            (parent) =>
              parent === "" ||
              folder === parent ||
              folder.startsWith(`${parent}/`)
          )
    );
  const pendingDirectories: Array<{ absolute: string; relative: string }> = [];
  for (const folder of scanFolders) {
    const absolute = path.resolve(externalRoot, folder);
    if (
      absolute !== externalRoot &&
      !absolute.startsWith(`${externalRoot}${path.sep}`)
    ) {
      throw new Error(`Cartella di scansione non valida: ${folder}`);
    }
    const folderStat = await stat(absolute);
    if (!folderStat.isDirectory()) {
      throw new Error(`Cartella di scansione non trovata: ${folder || "/"}`);
    }
    pendingDirectories.push({ absolute, relative: folder });
  }

  while (pendingDirectories.length) {
    const current = pendingDirectories.pop();
    if (!current) break;
    const directory = await opendir(current.absolute);

    for await (const entry of directory) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current.absolute, entry.name);
      const relative = current.relative
        ? path.join(current.relative, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        pendingDirectories.push({ absolute, relative });
        continue;
      }
      if (!entry.isFile()) continue;

      scanStatus.discovered += 1;
      const extension = path.extname(entry.name).toLowerCase();
      const mimeType = imageTypes[extension] ?? videoTypes[extension];
      if (!mimeType) continue;

      const fileStat = await stat(absolute);
      scanStatus.supported += 1;
      const originalPath = toPosix(path.join(storageRelativeRoot, relative));
      if (existingPaths.has(originalPath)) {
        scanStatus.skipped += 1;
        continue;
      }
      existingPaths.add(originalPath);
      batch.push({
        id: randomUUID(),
        title: path.basename(entry.name, extension),
        kind: imageTypes[extension] ? MediaKind.IMAGE : MediaKind.VIDEO,
        status: MediaStatus.READY,
        mimeType,
        bytes: BigInt(fileStat.size),
        capturedAt: fileStat.mtime,
        originalPath,
        sourceFileName: entry.name,
        directoryKey
      });

      if (batch.length >= 500) await flushBatch(batch);
    }
  }

  await flushBatch(batch);
}

export function getExternalScanStatus(): ExternalScanStatus {
  scanStatus.configured = Boolean(process.env.EXTERNAL_MEDIA_ROOT);
  return { ...scanStatus };
}

export async function getExternalLibraryInfo() {
  const settings = await getLibrarySettings();
  return {
    externalRoot: libraryPaths.externalRoot,
    storageRoot: libraryPaths.storageRoot,
    scanFolders: settings.scanFolders,
    uploadFolder: settings.uploadFolder
  };
}

export function startExternalLibraryScan() {
  if (!process.env.EXTERNAL_MEDIA_ROOT || scanStatus.running) {
    return getExternalScanStatus();
  }

  scanStatus.running = true;
  scanStatus.discovered = 0;
  scanStatus.supported = 0;
  scanStatus.added = 0;
  scanStatus.skipped = 0;
  scanStatus.error = null;
  scanStatus.startedAt = new Date().toISOString();
  scanStatus.completedAt = null;

  globalScanner.frameoExternalScanPromise = scanExternalLibrary()
    .catch((error) => {
      scanStatus.error =
        error instanceof Error ? error.message : "Errore sconosciuto durante la scansione.";
    })
    .finally(() => {
      scanStatus.running = false;
      scanStatus.completedAt = new Date().toISOString();
      globalScanner.frameoExternalScanPromise = undefined;
    });

  return getExternalScanStatus();
}
