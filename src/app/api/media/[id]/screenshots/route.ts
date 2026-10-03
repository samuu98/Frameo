import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAccessWhere, getRequestUser, requireEditor } from "@/lib/access-control";
import { mediaToJson } from "@/lib/media-json";
import { prisma } from "@/lib/prisma";
import { captureVideoScreenshot } from "@/lib/video-screenshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const captureSchema = z.object({
  timestampMs: z.number().int().min(0),
  title: z.string().trim().max(180).optional()
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ items: [], mode: "demo" });
  }
  const { id } = await context.params;
  const user = await getRequestUser(request);
  const source = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id, kind: MediaKind.VIDEO }, buildAccessWhere(user)] },
    select: { id: true }
  });
  if (!source) return NextResponse.json({ error: "Video non trovato" }, { status: 404 });
  const screenshots = await prisma.mediaAsset.findMany({
    where: { AND: [{ sourceMediaId: id }, buildAccessWhere(user)] },
    include: includeRelations,
    orderBy: { sourceTimeMs: "asc" }
  });
  return NextResponse.json({ items: screenshots.map(mediaToJson) });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = captureSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Timecode o nome dello screenshot non valido", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const { id } = await context.params;
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      item: {
        id: `screenshot-${Date.now()}`,
        title: parsed.data.title ?? "Video frame",
        kind: "IMAGE",
        status: "READY",
        bytes: "0",
        width: null,
        height: null,
        durationMs: null,
        createdAt: new Date().toISOString(),
        dominantColor: "#817A70",
        favorite: false,
        thumbnailUrl: null,
        previewUrl: null,
        originalUrl: "",
        streamUrl: null,
        markers: [],
        duplicateCount: 0,
        tags: [],
        people: [],
        groups: []
      },
      mode: "demo"
    }, { status: 201 });
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
    const screenshotId = await captureVideoScreenshot(
      id,
      parsed.data.timestampMs,
      parsed.data.title
    );
    const screenshot = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: screenshotId },
      include: includeRelations
    });
    return NextResponse.json({ item: mediaToJson(screenshot) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
      return NextResponse.json({ error: "Video non trovato" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Cattura non riuscita";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
