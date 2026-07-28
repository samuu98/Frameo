import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAccessWhere,
  getRequestUser,
  requireEditor
} from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const markerSchema = z.object({
  label: z.string().trim().min(1).max(100),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#6D5DFB"),
  note: z.string().trim().max(1000).nullable().optional(),
  featured: z.boolean().default(true)
}).refine((value) => value.endMs > value.startMs, {
  message: "La fine deve essere successiva all'inizio",
  path: ["endMs"]
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ markers: [], mode: "demo" });
  }
  const { id } = await context.params;
  const user = await getRequestUser(request);
  const accessible = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id }, buildAccessWhere(user)] },
    select: { id: true }
  });
  if (!accessible) return NextResponse.json({ error: "Media non trovato" }, { status: 404 });
  const markers = await prisma.highlightMarker.findMany({
    where: { mediaId: id },
    orderBy: { startMs: "asc" }
  });
  return NextResponse.json({ markers });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = markerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Marker non valido", issues: parsed.error.issues }, { status: 422 });
  }
  const { id } = await context.params;
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      marker: { id: `marker-${Date.now()}`, mediaId: id, ...parsed.data },
      mode: "demo"
    }, { status: 201 });
  }
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const media = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id }, buildAccessWhere(user)] },
    select: { kind: true, durationMs: true }
  });
  if (!media || media.kind !== MediaKind.VIDEO) {
    return NextResponse.json({ error: "I marker sono disponibili soltanto sui video" }, { status: 409 });
  }
  if (media.durationMs && parsed.data.endMs > media.durationMs) {
    return NextResponse.json({ error: "Il marker supera la durata del video" }, { status: 422 });
  }
  const marker = await prisma.highlightMarker.create({
    data: { mediaId: id, createdById: user?.id, ...parsed.data }
  });
  return NextResponse.json({ marker }, { status: 201 });
}
