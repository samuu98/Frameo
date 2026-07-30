import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAccessWhere,
  requireEditor
} from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  imageIds: z.array(z.string().min(1)).max(12)
});

const streamUrl = (storagePath: string | null) =>
  storagePath
    ? `/api/stream/${storagePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`
    : null;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json(
      { error: "Permessi di modifica richiesti" },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const url = new URL(request.url);
  const take = Math.max(1, Math.min(Number(url.searchParams.get("take") ?? 80), 200));
  const skip = Math.max(0, Number(url.searchParams.get("skip") ?? 0));
  const search = url.searchParams.get("search")?.trim();
  const where = {
    AND: [
      buildAccessWhere(user),
      { kind: MediaKind.IMAGE },
      { people: { some: { personId: id } } },
      ...(search
        ? [{
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { sourceFileName: { contains: search, mode: "insensitive" as const } }
            ]
          }]
        : [])
    ]
  };

  const [person, total, images, selectedImages] = await Promise.all([
    prisma.person.findUnique({ where: { id }, select: { id: true, name: true } }),
    prisma.mediaAsset.count({ where }),
    prisma.mediaAsset.findMany({
      where,
      select: {
        id: true,
        title: true,
        width: true,
        height: true,
        thumbnailPath: true,
        previewPath: true,
        originalPath: true,
        personReferences: {
          where: { personId: id },
          select: { mediaId: true }
        }
      },
      orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
      take,
      skip
    }),
    prisma.personReferenceImage.findMany({
      where: {
        personId: id,
        media: { people: { some: { personId: id } } }
      },
      select: { mediaId: true },
      orderBy: { sortOrder: "asc" }
    })
  ]);

  if (!person) {
    return NextResponse.json({ error: "Persona non trovata" }, { status: 404 });
  }

  return NextResponse.json({
    person,
    total,
    selectedIds: selectedImages.map(({ mediaId }) => mediaId),
    items: images.map((image) => ({
      id: image.id,
      title: image.title,
      width: image.width,
      height: image.height,
      displayUrl: `/api/media/${encodeURIComponent(image.id)}/display`,
      thumbnailUrl: streamUrl(image.thumbnailPath),
      previewUrl: streamUrl(image.previewPath),
      originalUrl: streamUrl(image.originalPath),
      selected: image.personReferences.length > 0
    }))
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Selezione immagini non valida", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json(
      { error: "Permessi di modifica richiesti" },
      { status: 403 }
    );
  }
  const { id } = await context.params;
  const imageIds = [...new Set(parsed.data.imageIds)];
  const [person, images] = await Promise.all([
    prisma.person.findUnique({ where: { id }, select: { id: true } }),
    prisma.mediaAsset.findMany({
      where: {
        AND: [
          buildAccessWhere(user),
          {
            id: { in: imageIds },
            kind: MediaKind.IMAGE,
            people: { some: { personId: id } }
          }
        ]
      },
      select: { id: true }
    })
  ]);
  if (!person) {
    return NextResponse.json({ error: "Persona non trovata" }, { status: 404 });
  }
  if (images.length !== imageIds.length) {
    return NextResponse.json(
      { error: "Una o più immagini non sono disponibili" },
      { status: 422 }
    );
  }
  await prisma.person.update({
    where: { id },
    data: {
      referenceImages: {
        deleteMany: {},
        create: imageIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder }))
      }
    }
  });
  return NextResponse.json({ ok: true, imageIds });
}
