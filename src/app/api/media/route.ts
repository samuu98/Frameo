import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { MediaKind, MediaStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerDuplicateMatches } from "@/lib/duplicate-detector";
import { getRequestUser, requireEditor } from "@/lib/access-control";
import { buildMediaWhere } from "@/lib/media-filters";
import { mediaToJson } from "@/lib/media-json";
import { enqueueMediaProcessing } from "@/lib/media-processor";
import {
  getLibrarySettings,
  resolveStorageFolder
} from "@/lib/library-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const includeRelations = {
  tags: { include: { tag: true } },
  people: { include: { person: true } },
  groups: { include: { group: true } },
  jobs: true,
  markers: true,
  duplicateSources: true,
  duplicateCandidates: true
} as const;

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ items: [], mode: "demo" });
  }

  const url = new URL(request.url);
  const take = Math.min(Number(url.searchParams.get("take") ?? 60), 200);
  const skip = Math.max(0, Number(url.searchParams.get("skip") ?? 0));
  const user = await getRequestUser(request);
  const where = buildMediaWhere(url, user);

  const accessWhere = buildMediaWhere(
    new URL(`${url.origin}${url.pathname}`),
    user
  );
  const orderBy =
    url.searchParams.get("sort") === "name"
      ? [{ title: "asc" as const }, { createdAt: "desc" as const }]
      : [{ capturedAt: "desc" as const }, { createdAt: "desc" as const }];
  const [items, total, imageCount, videoCount] = await prisma.$transaction([
    prisma.mediaAsset.findMany({
      where,
      include: includeRelations,
      orderBy,
      take,
      skip
    }),
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.count({
      where: { AND: [accessWhere, { kind: MediaKind.IMAGE }] }
    }),
    prisma.mediaAsset.count({
      where: { AND: [accessWhere, { kind: MediaKind.VIDEO }] }
    })
  ]);

  return NextResponse.json({
    items: items.map(mediaToJson),
    total,
    counts: {
      all: imageCount + videoCount,
      image: imageCount,
      video: videoCount
    }
  });
}

interface UploadResult {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  absolutePath: string;
  relativePath: string;
  contentHash: string;
}

async function streamUpload(request: Request): Promise<UploadResult> {
  if (!request.body) throw new Error("Upload body is empty");

  const id = randomUUID();
  const settings = await getLibrarySettings();
  const uploadRoot = resolveStorageFolder(settings.uploadFolder);
  const uploadDir = path.join(uploadRoot, id);
  await mkdir(uploadDir, { recursive: true });
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 ** 3);

  return new Promise((resolve, reject) => {
    let settled = false;
    let busboyFinished = false;
    let outputFinished = false;
    let bytes = 0;
    const hash = createHash("sha256");
    let result: Omit<UploadResult, "bytes" | "contentHash"> | null = null;
    const busboy = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      limits: { files: 1, fileSize: maxUploadBytes }
    });

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      const reason = error instanceof Error ? error : new Error(String(error));
      void rm(uploadDir, { recursive: true, force: true }).finally(() => reject(reason));
    };

    const finish = () => {
      if (settled || !busboyFinished || !outputFinished || !result) return;
      settled = true;
      resolve({ ...result, bytes, contentHash: hash.digest("hex") });
    };

    busboy.on("file", (_fieldName, file, info) => {
      const safeName = path.basename(info.filename).replace(/[^\w.\-() ]+/g, "_");
      const fileName = safeName || `${id}.bin`;
      const absolutePath = path.join(uploadDir, fileName);
      const relativePath = path.relative(storageRoot, absolutePath).split(path.sep).join("/");
      const output = createWriteStream(absolutePath, { flags: "wx" });
      result = {
        id,
        fileName,
        mimeType: info.mimeType || "application/octet-stream",
        absolutePath,
        relativePath
      };

      file.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        hash.update(chunk);
      });
      file.on("limit", () => {
        fail(new Error(`File exceeds the ${maxUploadBytes} byte limit`));
      });
      file.on("error", (error) => fail(error));
      output.on("error", (error) => fail(error));
      output.on("finish", () => {
        outputFinished = true;
        finish();
      });
      file.pipe(output);
    });

    busboy.on("filesLimit", () => fail(new Error("Only one file is accepted per request")));
    busboy.on("error", (error) => fail(error));
    busboy.on("finish", () => {
      busboyFinished = true;
      if (!result) {
        fail(new Error("No file field was found"));
        return;
      }
      finish();
    });

    const body = Readable.fromWeb(request.body as never);
    body.on("error", (error) => fail(error));
    body.pipe(busboy);
  });
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File mancante" }, { status: 400 });
    }
    return NextResponse.json(
      {
        item: {
          id: randomUUID(),
          title: file.name.replace(/\.[^/.]+$/, ""),
          status: "PROCESSING",
          kind: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
          bytes: String(file.size)
        },
        mode: "demo"
      },
      { status: 202 }
    );
  }

  try {
    await requireEditor(request);
    const uploaded = await streamUpload(request);
    const isVideo = uploaded.mimeType.startsWith("video/");
    const isImage = uploaded.mimeType.startsWith("image/");
    if (!isVideo && !isImage) {
      return NextResponse.json(
        { error: "Sono accettati soltanto file immagine o video." },
        { status: 415 }
      );
    }

    const media = await prisma.mediaAsset.create({
      data: {
        id: uploaded.id,
        title: uploaded.fileName.replace(/\.[^/.]+$/, ""),
        kind: isVideo ? MediaKind.VIDEO : MediaKind.IMAGE,
        status: MediaStatus.PROCESSING,
        mimeType: uploaded.mimeType,
        bytes: BigInt(uploaded.bytes),
        originalPath: uploaded.relativePath,
        sourceFileName: uploaded.fileName,
        contentHash: uploaded.contentHash,
        directoryKey: (await getLibrarySettings()).uploadFolder
      },
      include: includeRelations
    });

    void registerDuplicateMatches(media.id).catch((error) => {
      console.error(`Exact duplicate scan failed for media ${media.id}`, error);
    });
    void enqueueMediaProcessing(media.id).catch((error) => {
      console.error(`Processing failed for media ${media.id}`, error);
    });

    return NextResponse.json({ item: mediaToJson(media) }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_REQUIRED") {
      return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Upload non riuscito";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
