import { NextResponse } from "next/server";
import { buildAccessWhere, getRequestUser } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ total: 0, tags: [], groups: [] });
  }

  const { id } = await context.params;
  const user = await getRequestUser(request);
  const person = await prisma.person.findUnique({
    where: { id },
    select: { id: true }
  });
  if (!person) {
    return NextResponse.json({ error: "Persona non trovata" }, { status: 404 });
  }

  const media = await prisma.mediaAsset.findMany({
    where: {
      AND: [buildAccessWhere(user), { people: { some: { personId: id } } }]
    },
    select: {
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      groups: { select: { group: { select: { id: true, name: true, accent: true } } } }
    }
  });
  const tags = new Map<string, { id: string; name: string; color: string; count: number }>();
  const groups = new Map<string, { id: string; name: string; color: string; count: number }>();

  for (const item of media) {
    for (const { tag } of item.tags) {
      const current = tags.get(tag.id);
      tags.set(tag.id, { ...tag, count: (current?.count ?? 0) + 1 });
    }
    for (const { group } of item.groups) {
      const current = groups.get(group.id);
      groups.set(group.id, {
        id: group.id,
        name: group.name,
        color: group.accent,
        count: (current?.count ?? 0) + 1
      });
    }
  }

  const byName = (left: { name: string }, right: { name: string }) =>
    left.name.localeCompare(right.name, "it");
  return NextResponse.json({
    total: media.length,
    tags: [...tags.values()].sort(byName),
    groups: [...groups.values()].sort(byName)
  });
}
