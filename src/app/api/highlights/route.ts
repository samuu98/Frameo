import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/access-control";
import { buildMediaWhere } from "@/lib/media-filters";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ highlights: [], mode: "demo" });
  }
  const url = new URL(request.url);
  const user = await getRequestUser(request);
  const mediaWhere = buildMediaWhere(url, user);
  const highlights = await prisma.highlightMarker.findMany({
    where: {
      featured: true,
      media: {
        AND: [{ kind: MediaKind.VIDEO }, mediaWhere]
      }
    },
    include: {
      media: {
        include: {
          people: { include: { person: true } },
          tags: { include: { tag: true } },
          groups: { include: { group: true } }
        }
      }
    },
    orderBy: [{ createdAt: "desc" }, { startMs: "asc" }],
    take: Math.min(Number(url.searchParams.get("take") ?? 100), 300)
  });

  return NextResponse.json({
    highlights: highlights.map((highlight) => ({
      ...highlight,
      media: {
        ...highlight.media,
        bytes: highlight.media.bytes.toString(),
        sourceUrl: `/api/stream/${highlight.media.originalPath}`,
        previewUrl: highlight.media.previewPath
          ? `/api/stream/${highlight.media.previewPath}`
          : null,
        streamUrl: highlight.media.streamPath
          ? `/api/stream/${highlight.media.streamPath}`
          : null,
        posterUrl: highlight.media.thumbnailPath
          ? `/api/stream/${highlight.media.thumbnailPath}`
          : null,
        people: highlight.media.people.map(({ person }) => person),
        tags: highlight.media.tags.map(({ tag }) => tag),
        groups: highlight.media.groups.map(({ group }) => group)
      }
    }))
  });
}
