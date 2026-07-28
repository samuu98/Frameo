import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { buildAccessWhere, getRequestUser } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const mimeTypes: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t"
};

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const pathSegments = params.path.map(decodeURIComponent);
  const relativePath = pathSegments.join("/");
  const requested = pathSegments.join(path.sep);
  const absolutePath = path.resolve(storageRoot, requested);
  const storagePrefix = `${storageRoot}${path.sep}`;

  if (!absolutePath.startsWith(storagePrefix)) {
    return NextResponse.json({ error: "Percorso non valido" }, { status: 400 });
  }

  if (process.env.DATABASE_URL && process.env.DEMO_MODE !== "true") {
    const user = await getRequestUser(request);
    const derivedMediaId =
      pathSegments[0] === "derived" && pathSegments[1]
        ? pathSegments[1]
        : null;
    const media = await prisma.mediaAsset.findFirst({
      where: {
        AND: [
          buildAccessWhere(user),
          {
            OR: [
              { originalPath: relativePath },
              { thumbnailPath: relativePath },
              { previewPath: relativePath },
              { streamPath: relativePath },
              ...(derivedMediaId ? [{ id: derivedMediaId }] : [])
            ]
          }
        ]
      },
      select: { id: true }
    });
    if (!media) {
      return NextResponse.json({ error: "File non trovato" }, { status: 404 });
    }
  }

  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch {
    return NextResponse.json({ error: "File non trovato" }, { status: 404 });
  }
  if (!fileStat.isFile()) {
    return NextResponse.json({ error: "File non trovato" }, { status: 404 });
  }

  const contentType = mimeTypes[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.get("range");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416 });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), fileStat.size - 1) : fileStat.size - 1;
    if (start > end || start >= fileStat.size) return new Response(null, { status: 416 });

    const stream = createReadStream(absolutePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60, must-revalidate"
      }
    });
  }

  const stream = createReadStream(absolutePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(fileStat.size),
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60, must-revalidate"
    }
  });
}
