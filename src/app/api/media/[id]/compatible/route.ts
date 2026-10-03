import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildAccessWhere, getRequestUser, requireEditor } from "@/lib/access-control";
import { getCompatibleVideo, startCompatibleVideo } from "@/lib/compatible-video";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function allowed(request: Request, id: string) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") return null;
  const user = await getRequestUser(request);
  return prisma.mediaAsset.findFirst({ where: { AND: [{ id, kind: MediaKind.VIDEO }, buildAccessWhere(user)] }, select: { id: true } });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await allowed(request, id)) return NextResponse.json({ error: "Video non trovato" }, { status: 404 });
  return NextResponse.json(await getCompatibleVideo(id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try { await requireEditor(request); } catch { return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 }); }
  if (!await allowed(request, id)) return NextResponse.json({ error: "Video non trovato" }, { status: 404 });
  try { return NextResponse.json(await startCompatibleVideo(id), { status: 202 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Conversione non avviata" }, { status: 422 }); }
}
