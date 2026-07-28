import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { MediaKind, MediaStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mediaToJson } from "@/lib/media-json";
import { processMediaAsset } from "@/lib/media-processor";

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
  jobs: true
} as const;

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ items: [], mode: "demo" });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const take = Math.min(Number(url.searchParams.get("take") ?? 60), 200);

  const items = await prisma.mediaAsset.findMany({
    where:
      kind === "video"
        ? { kind: MediaKind.VIDEO }
        : kind === "image"
          ? { kind: MediaKind.IMAGE }
          : undefined,
    include: includeRelations,
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take
  });

  return NextResponse.json({ items: items.map(mediaToJson) });
}

interface UploadResult {
  id: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  absolutePath: string;
  relativePath: string;
}

async function streamUpload(request: Request): Promise<UploadResult> {
  if (!request.body) throw new Error("Upload body is empty");

  const id = randomUUID();
  const uploadDir = path.join(storageRoot, "originals", id);
  await mkdir(uploadDir, { recursive: true });
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 ** 3);

  return new Promise((resolve, reject) => {
    let resolved = false;
    let bytes = 0;
    let result: Omit<UploadResult, "bytes"> | null = null;
    const busboy = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      limits: { files: 1, fileSize: maxUploadBytes }
    });

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
      });
      file.on("limit", () => {
        reject(new Error(`File exceeds the ${maxUploadBytes} byte limit`));
      });
      file.on("error", reject);
      output.on("error", reject);
      file.pipe(output);
    });

    busboy.on("filesLimit", () => reject(new Error("Only one file is accepted per request")));
    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (resolved) return;
      resolved = true;
      if (!result) {
        reject(new Error("No file field was found"));
        return;
      }
      resolve({ ...result, bytes });
    });

    const body = Readable.fromWeb(request.body as never);
    body.on("error", reject);
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
        originalPath: uploaded.relativePath
      },
      include: includeRelations
    });

    void processMediaAsset(media.id).catch((error) => {
      console.error(`Processing failed for media ${media.id}`, error);
    });

    return NextResponse.json({ item: mediaToJson(media) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload non riuscito";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
