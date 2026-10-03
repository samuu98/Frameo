import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/access-control";
import { friendlyError, telegramDownloads } from "@/lib/telegram-downloads";
import { webDownloads } from "@/lib/web-downloads";
import { prisma } from "@/lib/prisma";
import { DownloadSource } from "@prisma/client";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor(request);
    const { id } = await context.params;
    const job = await prisma.downloadJob.findUnique({ where: { id }, select: { source: true } });
    if (!job) throw new Error("Download non trovato.");
    return NextResponse.json({ job: job.source === DownloadSource.WEB
      ? await webDownloads.retry(id) : await telegramDownloads.retry(id) });
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_REQUIRED") {
      return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
    }
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  }
}
