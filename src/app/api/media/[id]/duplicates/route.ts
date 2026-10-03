import { DuplicateStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { buildAccessWhere, getRequestUser } from "@/lib/access-control";
import { mediaToJson } from "@/lib/media-json";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return NextResponse.json({ duplicates: [], mode: "demo" });
  }
  const { id } = await context.params;
  const user = await getRequestUser(request);
  const source = await prisma.mediaAsset.findFirst({
    where: { AND: [{ id }, buildAccessWhere(user)] },
    select: { id: true }
  });
  if (!source) return NextResponse.json({ error: "Media non trovato" }, { status: 404 });

  const matches = await prisma.duplicateMatch.findMany({
    where: {
      status: DuplicateStatus.OPEN,
      OR: [{ sourceMediaId: id }, { candidateMediaId: id }]
    },
    orderBy: { similarity: "desc" }
  });
  const metadata = new Map(matches.map((match) => [
    match.sourceMediaId === id ? match.candidateMediaId : match.sourceMediaId,
    { matchId: match.id, similarity: match.similarity, reason: match.reason }
  ]));
  const media = metadata.size ? await prisma.mediaAsset.findMany({
    where: { AND: [{ id: { in: [...metadata.keys()] } }, buildAccessWhere(user)] },
    include: includeRelations
  }) : [];

  return NextResponse.json({
    duplicates: media.map((item) => ({
      ...mediaToJson(item),
      ...metadata.get(item.id)
    })).sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))
  });
}
