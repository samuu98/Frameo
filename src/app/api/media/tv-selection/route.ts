import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAccessWhere, requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({
  mediaIds: z.array(z.string().min(1)).min(1).max(500),
  showOnTv: z.boolean()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Selezione TV non valida" }, { status: 422 });
  const mediaIds = [...new Set(parsed.data.mediaIds)];
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ mediaIds, showOnTv: parsed.data.showOnTv, mode: "demo" });
  }
  let user;
  try { user = await requireEditor(request); }
  catch { return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 }); }
  const where = { AND: [buildAccessWhere(user), { id: { in: mediaIds } }] };
  const accessible = await prisma.mediaAsset.findMany({ where, select: { id: true } });
  if (accessible.length !== mediaIds.length) {
    return NextResponse.json({ error: "Uno o più media non sono disponibili" }, { status: 404 });
  }
  await prisma.mediaAsset.updateMany({ where, data: { showOnTv: parsed.data.showOnTv } });
  return NextResponse.json({ mediaIds, showOnTv: parsed.data.showOnTv });
}
