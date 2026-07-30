import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAccessWhere, requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  mediaIds: z.array(z.string().min(1)).min(1).max(500),
  addTagNames: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  addPersonNames: z.array(z.string().trim().min(1).max(64)).max(30).optional()
}).refine(
  ({ addTagNames, addPersonNames }) =>
    Boolean(addTagNames?.length || addPersonNames?.length),
  { message: "Nessuna assegnazione richiesta" }
);

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Richiesta non valida", issues: parsed.error.issues },
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

  const mediaIds = [...new Set(parsed.data.mediaIds)];
  const accessible = await prisma.mediaAsset.findMany({
    where: { AND: [buildAccessWhere(user), { id: { in: mediaIds } }] },
    select: { id: true }
  });
  const accessibleIds = accessible.map(({ id }) => id);
  if (!accessibleIds.length) {
    return NextResponse.json({ error: "Media non disponibili" }, { status: 404 });
  }

  const tagNames = [...new Set(parsed.data.addTagNames ?? [])];
  const personNames = [...new Set(parsed.data.addPersonNames ?? [])];
  const [tags, people] = await Promise.all([
    Promise.all(
      tagNames.map((name) =>
        prisma.tag.upsert({
          where: { name },
          update: {},
          create: { name }
        })
      )
    ),
    Promise.all(
      personNames.map((name) =>
        prisma.person.upsert({
          where: { name },
          update: {},
          create: { name }
        })
      )
    )
  ]);

  await prisma.$transaction([
    ...(tags.length
      ? [prisma.mediaTag.createMany({
          data: accessibleIds.flatMap((mediaId) =>
            tags.map(({ id: tagId }) => ({ mediaId, tagId }))
          ),
          skipDuplicates: true
        })]
      : []),
    ...(people.length
      ? [prisma.mediaPerson.createMany({
          data: accessibleIds.flatMap((mediaId) =>
            people.map(({ id: personId }) => ({ mediaId, personId }))
          ),
          skipDuplicates: true
        })]
      : [])
  ]);

  return NextResponse.json({
    updated: accessibleIds.length,
    skipped: mediaIds.length - accessibleIds.length
  });
}
