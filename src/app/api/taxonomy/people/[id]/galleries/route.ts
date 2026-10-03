import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAccessWhere, getRequestUser, requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});

const assignSchema = z.object({
  galleryId: z.string().min(1)
});

const streamUrl = (storagePath: string) =>
  `/api/stream/${storagePath.split("/").map(encodeURIComponent).join("/")}`;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ galleries: [], mode: "demo" });
  }
  const { id } = await context.params;
  const user = await getRequestUser(request);
  const person = await prisma.person.findUnique({ where: { id }, select: { id: true } });
  if (!person) return NextResponse.json({ error: "Performer non trovato" }, { status: 404 });

  const access = buildAccessWhere(user);
  const galleries = await prisma.group.findMany({
    where: { ownerPersonId: id },
    select: {
      id: true,
      name: true,
      accent: true,
      ownerPersonId: true,
      media: {
        where: { media: { AND: [access, { people: { some: { personId: id } } }] } },
        orderBy: { sortOrder: "asc" },
        select: {
          media: {
            select: {
              id: true,
              title: true,
              kind: true,
              durationMs: true,
              width: true,
              height: true,
              thumbnailPath: true,
              previewPath: true,
              streamPath: true,
              originalPath: true
            }
          }
        }
      }
    },
    orderBy: { name: "asc" }
  });

  return NextResponse.json({
    galleries: galleries.map(({ media, accent, ...gallery }) => ({
      ...gallery,
      color: accent,
      count: media.length,
      images: media.slice(0, 4).map(({ media: item }) => ({
        mediaId: item.id,
        title: item.title,
        url: streamUrl(item.thumbnailPath ?? item.previewPath ?? item.originalPath)
      })),
      previews: media.map(({ media: item }) => ({
        mediaId: item.id,
        title: item.title,
        type: item.kind === "VIDEO" ? "video" : "image",
        imageUrl: streamUrl(item.thumbnailPath ?? item.previewPath ?? item.originalPath),
        videoUrl: item.kind === "VIDEO" && item.previewPath ? streamUrl(item.previewPath) : null,
        originalUrl: item.kind === "VIDEO" ? streamUrl(item.originalPath) : null,
        streamUrl: item.streamPath?.endsWith(".mp4") ? streamUrl(item.streamPath) : null,
        durationMs: item.durationMs,
        width: item.width,
        height: item.height
      }))
    }))
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Nome della galleria non valido" }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      gallery: {
        id: `performer-gallery-${Date.now()}`,
        name: parsed.data.name,
        color: parsed.data.color ?? "#6D5DFB",
        count: 0,
        ownerPersonId: (await context.params).id,
        images: [],
        previews: []
      },
      mode: "demo"
    }, { status: 201 });
  }
  try {
    await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const { id } = await context.params;
  const person = await prisma.person.findUnique({ where: { id }, select: { id: true } });
  if (!person) return NextResponse.json({ error: "Performer non trovato" }, { status: 404 });

  try {
    const gallery = await prisma.group.create({
      data: {
        name: parsed.data.name,
        accent: parsed.data.color ?? "#6D5DFB",
        ownerPersonId: id
      }
    });
    return NextResponse.json({
      gallery: {
        id: gallery.id,
        name: gallery.name,
        color: gallery.accent,
        count: 0,
        ownerPersonId: gallery.ownerPersonId,
        images: [],
        previews: []
      }
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Esiste già una galleria con questo nome" }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = assignSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Galleria non valida" }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      gallery: {
        id: parsed.data.galleryId,
        name: "Galleria esistente",
        color: "#F97316",
        count: 0,
        ownerPersonId: (await context.params).id,
        images: [],
        previews: []
      },
      mode: "demo"
    });
  }

  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const { id } = await context.params;
  const [person, gallery] = await Promise.all([
    prisma.person.findUnique({ where: { id }, select: { id: true, name: true } }),
    prisma.group.findUnique({
      where: { id: parsed.data.galleryId },
      select: {
        id: true,
        name: true,
        accent: true,
        ownerPersonId: true,
        media: {
          orderBy: { sortOrder: "asc" },
          select: {
            mediaId: true,
            media: {
              select: {
                id: true,
                title: true,
                kind: true,
                durationMs: true,
                width: true,
                height: true,
                thumbnailPath: true,
                previewPath: true,
                originalPath: true
              }
            }
          }
        }
      }
    })
  ]);
  if (!person) return NextResponse.json({ error: "Performer non trovato" }, { status: 404 });
  if (!gallery || gallery.ownerPersonId) {
    return NextResponse.json({ error: "La galleria globale non è disponibile" }, { status: 409 });
  }

  const mediaIds = gallery.media.map(({ mediaId }) => mediaId);
  if (mediaIds.length) {
    const accessibleCount = await prisma.mediaAsset.count({
      where: { AND: [{ id: { in: mediaIds } }, buildAccessWhere(user)] }
    });
    if (accessibleCount !== mediaIds.length) {
      return NextResponse.json(
        { error: "Non hai accesso a tutti i media contenuti nella galleria" },
        { status: 403 }
      );
    }
  }

  await prisma.$transaction(async (transaction) => {
    if (mediaIds.length) {
      await transaction.mediaPerson.createMany({
        data: mediaIds.map((mediaId) => ({ mediaId, personId: id })),
        skipDuplicates: true
      });
    }
    await transaction.group.update({
      where: { id: gallery.id },
      data: { ownerPersonId: id }
    });
  });

  return NextResponse.json({
    gallery: {
      id: gallery.id,
      name: gallery.name,
      color: gallery.accent,
      count: gallery.media.length,
      ownerPersonId: id,
      images: gallery.media.slice(0, 4).map(({ media }) => ({
        mediaId: media.id,
        title: media.title,
        url: streamUrl(media.thumbnailPath ?? media.previewPath ?? media.originalPath)
      })),
      previews: gallery.media.slice(0, 8).map(({ media }) => ({
        mediaId: media.id,
        title: media.title,
        type: media.kind === "VIDEO" ? "video" : "image",
        imageUrl: streamUrl(media.thumbnailPath ?? media.previewPath ?? media.originalPath),
        videoUrl: media.kind === "VIDEO" && media.previewPath ? streamUrl(media.previewPath) : null,
        durationMs: media.durationMs,
        width: media.width,
        height: media.height
      }))
    },
    assignedMedia: mediaIds.length
  });
}
