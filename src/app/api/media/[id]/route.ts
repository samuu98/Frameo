import { MediaStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { mediaToJson } from "@/lib/media-json";

export const runtime = "nodejs";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  favorite: z.boolean().optional(),
  rating: z.number().int().min(0).max(5).optional(),
  capturedAt: z.iso.datetime().nullable().optional(),
  tagNames: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  personIds: z.array(z.string().min(1)).max(100).optional(),
  groupIds: z.array(z.string().min(1)).max(40).optional()
});

const includeRelations = {
  tags: { include: { tag: true } },
  people: { include: { person: true } },
  groups: { include: { group: true } },
  jobs: true
} as const;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ error: "Demo mode" }, { status: 404 });
  }
  const { id } = await context.params;
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    include: includeRelations
  });
  if (!media) return NextResponse.json({ error: "Media non trovato" }, { status: 404 });
  return NextResponse.json({ item: mediaToJson(media) });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, mode: "demo" });
  }
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dati non validi", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const { tagNames, personIds, groupIds, capturedAt, ...fields } = parsed.data;
  const update: Prisma.MediaAssetUpdateInput = {
    ...fields,
    capturedAt: capturedAt === null ? null : capturedAt ? new Date(capturedAt) : undefined
  };

  if (tagNames) {
    update.tags = {
      deleteMany: {},
      create: tagNames.map((name) => ({
        tag: {
          connectOrCreate: {
            where: { name },
            create: { name }
          }
        }
      }))
    };
  }
  if (personIds) {
    update.people = {
      deleteMany: {},
      create: personIds.map((personId) => ({ person: { connect: { id: personId } } }))
    };
  }
  if (groupIds) {
    update.groups = {
      deleteMany: {},
      create: groupIds.map((groupId, sortOrder) => ({
        sortOrder,
        group: { connect: { id: groupId } }
      }))
    };
  }

  try {
    const media = await prisma.mediaAsset.update({
      where: { id },
      data: update,
      include: includeRelations
    });
    return NextResponse.json({ item: mediaToJson(media) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Media non trovato" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, mode: "demo" });
  }
  const { id } = await context.params;
  await prisma.mediaAsset.update({
    where: { id },
    data: { status: MediaStatus.ERROR, description: "Marked for deletion" }
  });
  return NextResponse.json({ ok: true });
}
