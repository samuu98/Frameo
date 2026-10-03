import { rm } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildAccessWhere,
  getRequestUser,
  requireAdmin,
  requireEditor
} from "@/lib/access-control";
import { prisma } from "@/lib/prisma";
import { mediaToJson } from "@/lib/media-json";

export const runtime = "nodejs";

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const managedPath = (storagePath: string) => {
  const resolved = path.resolve(storageRoot, storagePath);
  if (resolved !== storageRoot && !resolved.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("Percorso del media non valido");
  }
  return resolved;
};

const updateSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  favorite: z.boolean().optional(),
  showOnTv: z.boolean().optional(),
  hideFromRandomHome: z.boolean().optional(),
  rating: z.number().int().min(0).max(5).optional(),
  capturedAt: z.iso.datetime().nullable().optional(),
  tagNames: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  personNames: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  personIds: z.array(z.string().min(1)).max(100).optional(),
  groupIds: z.array(z.string().min(1)).max(40).optional()
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
    return NextResponse.json({ error: "Demo mode" }, { status: 404 });
  }
  const { id } = await context.params;
  const user = await getRequestUser(request);
  const media = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id }, buildAccessWhere(user)] },
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

  const { tagNames, personNames, personIds, groupIds, capturedAt, ...fields } = parsed.data;
  let replacedGroupIds: string[] = [];
  if (groupIds) {
    const requestedGroups = await prisma.group.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, ownerPersonId: true }
    });
    if (requestedGroups.length !== new Set(groupIds).size) {
      return NextResponse.json({ error: "Galleria non trovata" }, { status: 404 });
    }
    const ownerScopes = new Set(requestedGroups.map(({ ownerPersonId }) => ownerPersonId ?? "global"));
    if (ownerScopes.size !== 1) {
      return NextResponse.json({ error: "Seleziona gallerie dello stesso ambito" }, { status: 422 });
    }
    const ownerPersonId = requestedGroups[0]?.ownerPersonId ?? null;
    const currentGroups = await prisma.groupMedia.findMany({
      where: {
        mediaId: id,
        group: ownerPersonId === null ? { ownerPersonId: null } : { ownerPersonId }
      },
      select: { groupId: true }
    });
    replacedGroupIds = currentGroups.map(({ groupId }) => groupId);
  }
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
  if (personNames) {
    update.people = {
      deleteMany: {},
      create: personNames.map((name) => ({
        person: {
          connectOrCreate: {
            where: { name },
            create: { name }
          }
        }
      }))
    };
  } else if (personIds) {
    update.people = {
      deleteMany: {},
      create: personIds.map((personId) => ({ person: { connect: { id: personId } } }))
    };
  }
  if (groupIds) {
    update.groups = {
      deleteMany: { groupId: { in: replacedGroupIds } },
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
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, mode: "demo" });
  }
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
  }
  const { id } = await context.params;
  const confirmation = request.headers.get("content-type")?.includes("application/json")
    ? await request.json().catch(() => null) as { confirm?: boolean } | null
    : null;
  if (confirmation?.confirm !== true) {
    return NextResponse.json(
      { error: "Conferma esplicita richiesta per eliminare il file dal disco" },
      { status: 422 }
    );
  }
  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      originalPath: true,
      thumbnailPath: true,
      previewPath: true,
      streamPath: true,
      directoryKey: true
    }
  });
  if (!media) return NextResponse.json({ error: "Media non trovato" }, { status: 404 });

  const targets = new Set<string>([
    media.originalPath,
    media.thumbnailPath,
    media.previewPath,
    media.streamPath
  ].filter((value): value is string => Boolean(value)));
  // Gli output derivati appartengono sempre in modo esclusivo al media.
  targets.add(`derived/${media.id}`);
  // Upload e screenshot hanno una cartella originale esclusiva con nome uguale all'id.
  const originalParent = path.posix.dirname(media.originalPath);
  if (path.posix.basename(originalParent) === media.id) targets.add(originalParent);

  const failures: string[] = [];
  for (const target of [...targets].sort((left, right) => right.length - left.length)) {
    try {
      await rm(managedPath(target), { recursive: true, force: true });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length) {
    return NextResponse.json(
      { error: "Impossibile eliminare tutti i file fisici", details: failures.slice(0, 5) },
      { status: 500 }
    );
  }
  await prisma.mediaAsset.delete({ where: { id } });
  return NextResponse.json({ ok: true, deletedFromDisk: true });
}
