import { MediaKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAccessWhere,
  requireEditor
} from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  imageIds: z.array(z.string().min(1)).max(12)
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Selezione immagini non valida", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  let user;
  try {
    user = await requireEditor(request);
  } catch {
    return NextResponse.json(
      { error: "Permessi di modifica richiesti" },
      { status: 403 }
    );
  }
  const { id } = await context.params;
  const imageIds = [...new Set(parsed.data.imageIds)];
  const [person, images] = await Promise.all([
    prisma.person.findUnique({ where: { id }, select: { id: true } }),
    prisma.mediaAsset.findMany({
      where: {
        AND: [
          buildAccessWhere(user),
          { id: { in: imageIds }, kind: MediaKind.IMAGE }
        ]
      },
      select: { id: true }
    })
  ]);
  if (!person) {
    return NextResponse.json({ error: "Persona non trovata" }, { status: 404 });
  }
  if (images.length !== imageIds.length) {
    return NextResponse.json(
      { error: "Una o più immagini non sono disponibili" },
      { status: 422 }
    );
  }
  await prisma.person.update({
    where: { id },
    data: {
      referenceImages: {
        deleteMany: {},
        create: imageIds.map((mediaId, sortOrder) => ({ mediaId, sortOrder }))
      }
    }
  });
  return NextResponse.json({ ok: true, imageIds });
}
