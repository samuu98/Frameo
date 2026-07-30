import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const streamUrl = (storagePath: string) =>
  `/api/stream/${storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

export async function GET() {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      people: ["Sofia", "Luca", "Elena", "Jonas"],
      tags: ["viaggio", "estate", "drone", "ritratto", "architettura", "portfolio"],
      groups: ["Australia 2026", "Portraits", "Urban studies", "Da catalogare"],
      mode: "demo"
    });
  }
  const [people, tags, groups] = await Promise.all([
    prisma.person.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { media: true } },
        referenceImages: {
          orderBy: { sortOrder: "asc" },
          select: {
            media: {
              select: {
                id: true,
                title: true,
                thumbnailPath: true,
                previewPath: true,
                originalPath: true
              }
            }
          }
        }
      },
      orderBy: { name: "asc" }
    }),
    prisma.tag.findMany({
      select: { id: true, name: true, color: true, _count: { select: { media: true } } },
      orderBy: { name: "asc" }
    }),
    prisma.group.findMany({ select: { id: true, name: true, accent: true }, orderBy: { name: "asc" } })
  ]);
  return NextResponse.json({
    people: people.map(({ _count, referenceImages, ...person }) => ({
      ...person,
      count: _count.media,
      images: referenceImages.map(({ media }) => ({
        mediaId: media.id,
        title: media.title,
        url: streamUrl(
          media.thumbnailPath ?? media.previewPath ?? media.originalPath
        )
      }))
    })),
    tags: tags.map(({ _count, ...tag }) => ({
      ...tag,
      count: _count.media
    })),
    groups
  });
}

const createTaxonomySchema = z.object({
  kind: z.enum(["PERSON", "TAG"]),
  name: z.string().trim().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ error: "Operazione non disponibile in demo" }, { status: 400 });
  }
  try {
    await requireEditor(request);
  } catch {
    return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
  }

  const parsed = createTaxonomySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dati non validi" }, { status: 422 });
  }

  if (parsed.data.kind === "PERSON") {
    const person = await prisma.person.upsert({
      where: { name: parsed.data.name },
      update: {},
      create: { name: parsed.data.name }
    });
    return NextResponse.json({ entry: { ...person, count: 0 } }, { status: 201 });
  }

  const tag = await prisma.tag.upsert({
    where: { name: parsed.data.name },
    update: parsed.data.color ? { color: parsed.data.color } : {},
    create: {
      name: parsed.data.name,
      color: parsed.data.color ?? "#8B5CF6"
    }
  });
  return NextResponse.json({ entry: { ...tag, count: 0 } }, { status: 201 });
}
