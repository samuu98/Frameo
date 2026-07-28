import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAccessWhere, requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().positive().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  featured: z.boolean().optional()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; markerId: string }> }
) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Marker non valido", issues: parsed.error.issues }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ marker: { ...(await context.params), ...parsed.data }, mode: "demo" });
  }
  const { id, markerId } = await context.params;
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const accessible = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id }, buildAccessWhere(user)] },
    select: { id: true }
  });
  if (!accessible) return NextResponse.json({ error: "Media non trovato" }, { status: 404 });
  const marker = await prisma.highlightMarker.update({
    where: { id: markerId, mediaId: id },
    data: parsed.data
  });
  return NextResponse.json({ marker });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; markerId: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, mode: "demo" });
  }
  const { id, markerId } = await context.params;
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }
  const accessible = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id }, buildAccessWhere(user)] },
    select: { id: true }
  });
  if (!accessible) return NextResponse.json({ error: "Media non trovato" }, { status: 404 });
  await prisma.highlightMarker.delete({ where: { id: markerId, mediaId: id } });
  return NextResponse.json({ ok: true });
}
