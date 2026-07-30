import { randomUUID } from "node:crypto";
import { ImportState } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const skippedImportSchema = z.object({
  files: z.array(
    z.object({
      name: z.string().trim().min(1).max(255),
      mimeType: z.string().max(255).optional(),
      bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      reason: z.string().trim().min(1).max(4000)
    })
  ).max(500)
});

export async function POST(request: Request) {
  try {
    await requireEditor(request);
  } catch {
    return NextResponse.json(
      { error: "Permessi di modifica richiesti" },
      { status: 403 }
    );
  }

  const parsed = skippedImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Elenco importazioni non valido" },
      { status: 422 }
    );
  }

  if (parsed.data.files.length) {
    const completedAt = new Date();
    await prisma.importAttempt.createMany({
      data: parsed.data.files.map((file) => ({
        id: randomUUID(),
        fileName: file.name,
        mimeType: file.mimeType || null,
        totalBytes: BigInt(file.bytes),
        uploadedBytes: BigInt(0),
        progress: 0,
        state: ImportState.SKIPPED,
        error: file.reason,
        completedAt
      }))
    });
  }

  return NextResponse.json({ recorded: parsed.data.files.length }, { status: 201 });
}
