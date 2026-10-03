import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const streamUrl = (storagePath: string) =>
  `/api/stream/${storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

export async function GET() {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      people: ["Sofia", "Luca", "Elena", "Jonas"],
      tags: ["viaggio", "estate", "drone", "ritratto", "architettura", "portfolio"],
      groups: ["Australia 2026", "Portraits", "Urban studies"],
      mode: "demo"
    });
  }
  const [people, tags, groups] = await Promise.all([
    prisma.person.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { media: true } },
        coverMedia: {
          select: { id: true, title: true, thumbnailPath: true, previewPath: true, originalPath: true }
        },
        profileMedia: {
          select: { id: true, title: true, thumbnailPath: true, previewPath: true, originalPath: true }
        },
        referenceImages: {
          orderBy: { sortOrder: "asc" },
          select: {
            media: {
              select: {
                id: true,
                title: true,
                thumbnailPath: true,
                previewPath: true,
                originalPath: true
              }
            }
          }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.tag.findMany({
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { media: true } },
        media: {
          take: 4,
          orderBy: { media: { createdAt: "desc" } },
          select: {
            media: { select: { id: true, title: true, thumbnailPath: true, previewPath: true, originalPath: true } }
          }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.group.findMany({
      where: { ownerPersonId: null },
      select: {
        id: true,
        name: true,
        accent: true,
        _count: { select: { media: true } },
        media: {
          take: 4,
          orderBy: { sortOrder: "asc" },
          select: {
            media: { select: { id: true, title: true, thumbnailPath: true, previewPath: true, originalPath: true } }
          }
        }
      },
      orderBy: { name: "asc" }
    })
  ]);
  return NextResponse.json({
    people: people.map(({ _count, referenceImages, coverMedia, profileMedia, ...person }) => {
      const orderedMedia = [profileMedia, coverMedia, ...referenceImages.map(({ media }) => media)]
        .filter((media): media is NonNullable<typeof media> => Boolean(media))
        .filter((media, index, all) => all.findIndex(({ id }) => id === media.id) === index);
      return {
      ...person,
      count: _count.media,
      coverImageId: coverMedia?.id ?? null,
      profileImageId: profileMedia?.id ?? null,
      images: orderedMedia.map((media) => ({
        mediaId: media.id,
        title: media.title,
        url: streamUrl(
          media.thumbnailPath ?? media.previewPath ?? media.originalPath
        )
      }))
    }}),
    tags: tags.map(({ _count, media, ...tag }) => ({
      ...tag,
      count: _count.media,
      images: media.map(({ media: item }) => ({
        mediaId: item.id,
        title: item.title,
        url: streamUrl(item.thumbnailPath ?? item.previewPath ?? item.originalPath)
      }))
    })),
    groups: groups.map(({ _count, media, ...group }) => ({
      ...group,
      count: _count.media,
      images: media.map(({ media: item }) => ({
        mediaId: item.id,
        title: item.title,
        url: streamUrl(item.thumbnailPath ?? item.previewPath ?? item.originalPath)
      }))
    }))
  });
}

const createTaxonomySchema = z.object({
  kind: z.enum(["PERSON", "TAG", "GROUP"]),
  name: z.string().trim().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ error: "Operazione non disponibile in demo" }, { status: 400 });
  }
  try {
    await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }

  const parsed = createTaxonomySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dati non validi" }, { status: 422 });
  }

  if (parsed.data.kind === "PERSON") {
    const person = await prisma.person.upsert({
      where: { name: parsed.data.name },
      update: {},
      create: { name: parsed.data.name }
    });
    return NextResponse.json({ entry: { ...person, count: 0 } }, { status: 201 });
  }

  if (parsed.data.kind === "GROUP") {
    const group = await prisma.group.upsert({
      where: { name: parsed.data.name },
      update: parsed.data.color ? { accent: parsed.data.color } : {},
      create: { name: parsed.data.name, accent: parsed.data.color ?? "#F97316" },
      include: { _count: { select: { media: true } } }
    });
    const { _count, ...entry } = group;
    return NextResponse.json({ entry: { ...entry, count: _count.media, color: group.accent } }, { status: 201 });
  }

  const tag = await prisma.tag.upsert({
    where: { name: parsed.data.name },
    update: parsed.data.color ? { color: parsed.data.color } : {},
    create: {
      name: parsed.data.name,
      color: parsed.data.color ?? "#8B5CF6"
    }
  });
  return NextResponse.json({ entry: { ...tag, count: 0 } }, { status: 201 });
}
