import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";
import { MediaKind } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fileSchema = z.object({
  name: z.string().trim().min(1).max(260),
  bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  durationMs: z.number().int().positive().nullable().optional()
});

const requestSchema = z.object({
  files: z.array(fileSchema).min(1).max(500)
});

const storageRoot = path.resolve(
  process.env.STORAGE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd(), "storage")
);

const probeDuration = (relativePath: string) =>
  new Promise<number | null>((resolve) => {
    const absolutePath = path.resolve(storageRoot, relativePath);
    if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
      resolve(null);
      return;
    }
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        absolutePath
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const seconds = Number.parseFloat(output.trim());
      resolve(
        code === 0 && Number.isFinite(seconds) && seconds > 0
          ? Math.round(seconds * 1000)
          : null
      );
    });
  });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Elenco file non valido", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      results: parsed.data.files.map(() => ({ duplicate: false, match: null }))
    });
  }

  try {
    await requireEditor(request);
  } catch {
    return NextResponse.json(
      { error: "Permessi di modifica richiesti" },
      { status: 403 }
    );
  }

  const candidates = await prisma.mediaAsset.findMany({
    where: {
      OR: parsed.data.files.map((file) => ({
        sourceFileName: { equals: file.name, mode: "insensitive" as const },
        bytes: BigInt(file.bytes)
      }))
    },
    select: {
      id: true,
      title: true,
      sourceFileName: true,
      bytes: true,
      durationMs: true,
      kind: true,
      originalPath: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" },
    take: 1000
  });

  const requestedDurations = new Map(
    parsed.data.files.map((file) => [
      `${file.name.toLocaleLowerCase("it")}\u0000${file.bytes}`,
      file.durationMs ?? null
    ])
  );
  for (let index = 0; index < candidates.length; index += 4) {
    await Promise.all(
      candidates.slice(index, index + 4).map(async (candidate) => {
        if (candidate.kind !== MediaKind.VIDEO || candidate.durationMs) return;
        const signature = `${candidate.sourceFileName?.toLocaleLowerCase("it")}\u0000${candidate.bytes}`;
        if (!requestedDurations.get(signature)) return;
        const durationMs = await probeDuration(candidate.originalPath);
        if (!durationMs) return;
        candidate.durationMs = durationMs;
        await prisma.mediaAsset
          .update({
            where: { id: candidate.id },
            data: { durationMs }
          })
          .catch(() => undefined);
      })
    );
  }

  const seenInBatch = new Map<string, number>();
  const results = parsed.data.files.map((file, index) => {
    const signature = `${file.name.toLocaleLowerCase("it")}\u0000${file.bytes}\u0000${file.durationMs ?? ""}`;
    const batchMatch = seenInBatch.get(signature);
    if (batchMatch !== undefined) {
      return {
        duplicate: true,
        confidence: "EXACT" as const,
        reason: "Lo stesso file è già presente in questa selezione.",
        batchMatch,
        match: null
      };
    }
    seenInBatch.set(signature, index);

    const name = file.name.toLocaleLowerCase("it");
    const matching = candidates
      .filter(
        (candidate) =>
          candidate.sourceFileName?.toLocaleLowerCase("it") === name &&
          candidate.bytes === BigInt(file.bytes)
      )
      .map((candidate) => {
        const durationKnown =
          typeof file.durationMs === "number" &&
          typeof candidate.durationMs === "number";
        const durationMatches =
          !durationKnown ||
          Math.abs((candidate.durationMs as number) - (file.durationMs as number)) <=
            1500;
        return { candidate, durationKnown, durationMatches };
      })
      .find(({ durationMatches }) => durationMatches);

    if (!matching) return { duplicate: false, match: null };
    const { candidate, durationKnown } = matching;
    return {
      duplicate: true,
      confidence: durationKnown ? ("EXACT" as const) : ("PROBABLE" as const),
      reason: durationKnown
        ? "Nome, dimensione e durata coincidono."
        : "Nome e dimensione coincidono; la durata non è ancora disponibile nell’indice.",
      match: {
        id: candidate.id,
        title: candidate.title,
        sourceFileName: candidate.sourceFileName,
        bytes: Number(candidate.bytes),
        durationMs: candidate.durationMs,
        importedAt: candidate.createdAt.toISOString()
      }
    };
  });

  return NextResponse.json({ results });
}
