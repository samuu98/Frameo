import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAccessWhere, requireEditor } from "@/lib/access-control";
import { mediaToJson } from "@/lib/media-json";
import { prisma } from "@/lib/prisma";
import { setVideoThumbnail } from "@/lib/video-thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  timestampMs: z.number().int().min(0)
});

const includeRelations = {
  tags: { include: { tag: true } },
  people: { include: { person: true } },
  groups: { include: { group: true } },
  jobs: true,
  markers: true,
  duplicateSources: true,
  duplicateCandidates: true
} as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Timecode della thumbnail non valido", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const { id } = await context.params;
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, mode: "demo", timestampMs: parsed.data.timestampMs });
  }

  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const source = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id, kind: MediaKind.VIDEO }, buildAccessWhere(user)] },
    select: { id: true, durationMs: true }
  });
  if (!source) return NextResponse.json({ error: "Video non trovato" }, { status: 404 });
  if (source.durationMs && parsed.data.timestampMs >= source.durationMs) {
    return NextResponse.json({ error: "Il timecode supera la durata del video" }, { status: 422 });
  }

  try {
    await setVideoThumbnail(id, parsed.data.timestampMs);
    const media = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id },
      include: includeRelations
    });
    return NextResponse.json({ item: mediaToJson(media) });
  } catch (error) {
    if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
      return NextResponse.json({ error: "Video non trovato" }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Thumbnail non aggiornata" },
      { status: 500 }
    );
  }
}
