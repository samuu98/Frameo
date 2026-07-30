import path from "node:path";
import sharp from "sharp";
import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildAccessWhere, getRequestUser } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ error: "Immagine non disponibile" }, { status: 404 });
  }

  const { id } = await context.params;
  const user = await getRequestUser(request);
  const media = await prisma.mediaAsset.findFirst({
    where: {
      AND: [
        { id, kind: MediaKind.IMAGE },
        buildAccessWhere(user)
      ]
    },
    select: {
      originalPath: true,
      previewPath: true,
      thumbnailPath: true,
      updatedAt: true
    }
  });
  if (!media) {
    return NextResponse.json({ error: "Immagine non trovata" }, { status: 404 });
  }

  const url = new URL(request.url);
  const requestedWidth = Number(url.searchParams.get("width") ?? 640);
  const width = Math.max(
    240,
    Math.min(Number.isFinite(requestedWidth) ? Math.round(requestedWidth) : 640, 1600)
  );
  const relativePath =
    width <= 720
      ? media.thumbnailPath ?? media.previewPath ?? media.originalPath
      : media.previewPath ?? media.thumbnailPath ?? media.originalPath;
  const inputPath = path.resolve(storageRoot, relativePath);
  if (inputPath !== storageRoot && !inputPath.startsWith(`${storageRoot}${path.sep}`)) {
    return NextResponse.json({ error: "Percorso immagine non valido" }, { status: 400 });
  }

  try {
    const output = await sharp(inputPath, { failOn: "none" })
      .rotate()
      .resize(width, width, {
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: width > 900 ? 88 : 80, effort: 3 })
      .toBuffer();
    return new NextResponse(new Uint8Array(output), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
        ETag: `"${id}-${media.updatedAt.getTime()}-${width}"`
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Formato immagine non visualizzabile" },
      { status: 422 }
    );
  }
}
