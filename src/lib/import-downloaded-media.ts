import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { MediaKind, MediaStatus } from "@prisma/client";
import { registerDuplicateMatches } from "@/lib/duplicate-detector";
import { getLibrarySettings, resolveStorageFolder } from "@/lib/library-settings";
import { enqueueMediaProcessing } from "@/lib/media-processor";
import { prisma } from "@/lib/prisma";

const videoMimeByExtension = new Map([
  [".mp4", "video/mp4"], [".m4v", "video/mp4"], [".mov", "video/quicktime"],
  [".mkv", "video/x-matroska"], [".webm", "video/webm"], [".avi", "video/x-msvideo"],
  [".wmv", "video/x-ms-wmv"], [".mpeg", "video/mpeg"], [".mpg", "video/mpeg"]
]);

const imageMimeByExtension = new Map([
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"],
  [".webp", "image/webp"], [".gif", "image/gif"], [".heic", "image/heic"],
  [".heif", "image/heif"], [".tif", "image/tiff"], [".tiff", "image/tiff"],
  [".avif", "image/avif"]
]);

const hashFile = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });

export async function importDownloadedMedia(inputPath: string, requestedName: string) {
  const fileName = path.basename(requestedName).replace(/[^\w.\-() ]+/g, "_") || "download.bin";
  const extension = path.extname(fileName).toLocaleLowerCase("en");
  const mimeType = videoMimeByExtension.get(extension) ?? imageMimeByExtension.get(extension);
  if (!mimeType) {
    throw new Error("Il file scaricato non è un video o un'immagine supportata da Frameo.");
  }

  const id = randomUUID();
  const settings = await getLibrarySettings();
  const destinationDirectory = path.join(resolveStorageFolder(settings.uploadFolder), id);
  const destination = path.join(destinationDirectory, fileName);
  await mkdir(destinationDirectory, { recursive: true });
  await rename(inputPath, destination);

  const [details, contentHash] = await Promise.all([stat(destination), hashFile(destination)]);
  const storageRoot = resolveStorageFolder("");
  const relativePath = path.relative(storageRoot, destination).split(path.sep).join("/");
  const media = await prisma.mediaAsset.create({
    data: {
      id,
      title: fileName.replace(/\.[^/.]+$/, ""),
      kind: mimeType.startsWith("video/") ? MediaKind.VIDEO : MediaKind.IMAGE,
      status: MediaStatus.PROCESSING,
      mimeType,
      bytes: BigInt(details.size),
      originalPath: relativePath,
      sourceFileName: fileName,
      contentHash,
      directoryKey: settings.uploadFolder
    }
  });

  void registerDuplicateMatches(media.id).catch((error) => {
    console.error(`Exact duplicate scan failed for downloaded media ${media.id}`, error);
  });
  void enqueueMediaProcessing(media.id).catch((error) => {
    console.error(`Processing failed for downloaded media ${media.id}`, error);
  });
  return media;
}
