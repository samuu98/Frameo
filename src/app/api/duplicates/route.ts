import { DuplicateStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/access-control";
import { registerDuplicateMatches } from "@/lib/duplicate-detector";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const demoMatches = [
  {
    id: "duplicate-demo-1",
    similarity: 1,
    reason: "SHA-256 identico",
    status: "OPEN",
    source: { id: "coastline-drive", title: "Coastline Drive", kind: "VIDEO" },
    candidate: { id: "coastline-drive-copy", title: "Coastline Drive copy", kind: "VIDEO" }
  },
  {
    id: "duplicate-demo-2",
    similarity: 0.94,
    reason: "Immagine visivamente simile",
    status: "OPEN",
    source: { id: "facade-12", title: "Façade no. 12", kind: "IMAGE" },
    candidate: { id: "facade-12-edit", title: "Façade no. 12 edit", kind: "IMAGE" }
  }
];

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ matches: demoMatches, mode: "demo" });
  }
  try {
    await requireAdmin(request);
    const matches = await prisma.duplicateMatch.findMany({
      where: { status: DuplicateStatus.OPEN },
      include: {
        source: {
          select: {
            id: true,
            title: true,
            kind: true,
            bytes: true,
            thumbnailPath: true,
            originalPath: true
          }
        },
        candidate: {
          select: {
            id: true,
            title: true,
            kind: true,
            bytes: true,
            thumbnailPath: true,
            originalPath: true
          }
        }
      },
      orderBy: [{ similarity: "desc" }, { createdAt: "desc" }]
    });
    return NextResponse.json({
      matches: matches.map((match) => ({
        ...match,
        source: {
          ...match.source,
          bytes: match.source.bytes.toString(),
          thumbnailUrl: match.source.thumbnailPath
            ? `/api/stream/${match.source.thumbnailPath}`
            : null
        },
        candidate: {
          ...match.candidate,
          bytes: match.candidate.bytes.toString(),
          thumbnailUrl: match.candidate.thumbnailPath
            ? `/api/stream/${match.candidate.thumbnailPath}`
            : null
        }
      }))
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ scanned: 24, matches: demoMatches.length, mode: "demo" });
  }
  try {
    await requireAdmin(request);
    const assets = await prisma.mediaAsset.findMany({
      where: {
        OR: [{ contentHash: { not: null } }, { perceptualHash: { not: null } }]
      },
      select: { id: true },
      take: 2000
    });
    let detected = 0;
    for (const asset of assets) {
      detected += (await registerDuplicateMatches(asset.id)).length;
    }
    return NextResponse.json({ scanned: assets.length, matches: detected });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}
