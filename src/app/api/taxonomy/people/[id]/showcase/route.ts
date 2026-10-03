import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildAccessWhere, getRequestUser } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const streamUrl = (storagePath: string | null) => storagePath
  ? `/api/stream/${storagePath.split("/").map(encodeURIComponent).join("/")}`
  : null;

const visual = (media: {
  id: string;
  title: string;
  thumbnailPath: string | null;
  previewPath: string | null;
  originalPath: string;
  kind?: MediaKind;
  durationMs?: number | null;
  favorite?: boolean;
}) => ({
  id: media.id,
  title: media.title,
  type: media.kind === MediaKind.VIDEO ? "video" : "image",
  imageUrl: streamUrl(media.thumbnailPath ?? media.previewPath ?? media.originalPath),
  originalUrl: streamUrl(media.originalPath),
  previewUrl: streamUrl(media.previewPath),
  durationMs: media.durationMs ?? null,
  favorite: media.favorite ?? false
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ showcase: null, mode: "demo" });
  }
  const { id } = await context.params;
  const user = await getRequestUser(request);
  const access = buildAccessWhere(user);
  const person = await prisma.person.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      coverMediaId: true,
      profileMediaId: true,
      referenceImages: {
        orderBy: { sortOrder: "asc" },
        select: {
          media: { select: { id: true, title: true, thumbnailPath: true, previewPath: true, originalPath: true, kind: true } }
        }
      }
    }
  });
  if (!person) return NextResponse.json({ error: "Performer non trovato" }, { status: 404 });

  const roleMedia = await prisma.mediaAsset.findMany({
    where: {
      AND: [
        access,
        { id: { in: [person.coverMediaId, person.profileMediaId].filter((value): value is string => Boolean(value)) } }
      ]
    },
    select: { id: true, title: true, kind: true, durationMs: true, thumbnailPath: true, previewPath: true, originalPath: true }
  });
  const roleMediaById = new Map(roleMedia.map((media) => [media.id, visual(media)]));

  const performerWhere = { AND: [access, { people: { some: { personId: id } } }] };
  const [total, videos, images, favorites, highlightRows, collaborationRows, facetRows] = await Promise.all([
    prisma.mediaAsset.count({ where: performerWhere }),
    prisma.mediaAsset.count({ where: { AND: [performerWhere, { kind: MediaKind.VIDEO }] } }),
    prisma.mediaAsset.count({ where: { AND: [performerWhere, { kind: MediaKind.IMAGE }] } }),
    prisma.mediaAsset.findMany({
      where: { AND: [performerWhere, { favorite: true }] },
      select: { id: true, title: true, kind: true, favorite: true, durationMs: true, thumbnailPath: true, previewPath: true, originalPath: true },
      orderBy: [{ rating: "desc" }, { updatedAt: "desc" }],
      take: 12
    }),
    prisma.highlightMarker.findMany({
      where: { featured: true, media: performerWhere },
      include: { media: { select: { id: true, title: true, kind: true, durationMs: true, thumbnailPath: true, previewPath: true, originalPath: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20
    }),
    prisma.mediaAsset.findMany({
      where: { AND: [performerWhere, { people: { some: { personId: { not: id } } } }] },
      select: {
        id: true,
        title: true,
        kind: true,
        durationMs: true,
        thumbnailPath: true,
        previewPath: true,
        originalPath: true,
        people: { where: { personId: { not: id } }, select: { person: { select: { id: true, name: true } } } }
      },
      orderBy: { createdAt: "desc" },
      take: 30
    }),
    prisma.mediaAsset.findMany({
      where: performerWhere,
      select: {
        tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
        groups: {
          where: { group: { ownerPersonId: null } },
          select: { group: { select: { id: true, name: true, accent: true } } }
        },
        thumbnailPath: true,
        previewPath: true,
        originalPath: true
      },
      orderBy: { createdAt: "desc" },
      take: 300
    })
  ]);

  const tags = new Map<string, { id: string; name: string; color: string; count: number; previewUrl: string | null }>();
  const groups = new Map<string, { id: string; name: string; color: string; count: number; previewUrl: string | null }>();
  facetRows.forEach((row) => {
    const previewUrl = streamUrl(row.thumbnailPath ?? row.previewPath ?? row.originalPath);
    row.tags.forEach(({ tag }) => {
      const current = tags.get(tag.id);
      tags.set(tag.id, { ...tag, count: (current?.count ?? 0) + 1, previewUrl: current?.previewUrl ?? previewUrl });
    });
    row.groups.forEach(({ group }) => {
      const current = groups.get(group.id);
      groups.set(group.id, { id: group.id, name: group.name, color: group.accent, count: (current?.count ?? 0) + 1, previewUrl: current?.previewUrl ?? previewUrl });
    });
  });

  const collaborators = new Map<string, { id: string; name: string; count: number; previews: string[] }>();
  collaborationRows.forEach((row) => row.people.forEach(({ person: collaborator }) => {
    const current = collaborators.get(collaborator.id) ?? { ...collaborator, count: 0, previews: [] };
    current.count += 1;
    const preview = streamUrl(row.thumbnailPath ?? row.previewPath ?? row.originalPath);
    if (preview && current.previews.length < 3) current.previews.push(preview);
    collaborators.set(collaborator.id, current);
  }));

  return NextResponse.json({
    showcase: {
      person: {
        id: person.id,
        name: person.name,
        coverImage: person.coverMediaId ? roleMediaById.get(person.coverMediaId) ?? null : null,
        profileImage: person.profileMediaId ? roleMediaById.get(person.profileMediaId) ?? null : null
      },
      stats: { total, videos, images, highlights: highlightRows.length, collaborations: collaborationRows.length },
      gallery: person.referenceImages.map(({ media }) => visual(media)),
      favorites: favorites.map(visual),
      highlights: highlightRows.map((marker) => ({
        id: marker.id,
        label: marker.label,
        startMs: marker.startMs,
        endMs: marker.endMs,
        color: marker.color,
        media: visual(marker.media)
      })),
      collaborators: [...collaborators.values()].sort((a, b) => b.count - a.count),
      collaborationMedia: collaborationRows.slice(0, 12).map((row) => ({
        ...visual(row),
        people: row.people.map(({ person: collaborator }) => collaborator)
      })),
      tags: [...tags.values()].sort((a, b) => b.count - a.count).slice(0, 16),
      groups: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 12)
    }
  });
}
