import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/access-control";
import { friendlyError, telegramDownloads } from "@/lib/telegram-downloads";
import { webDownloads } from "@/lib/web-downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  source: z.enum(["telegram", "web"]),
  url: z.string().trim().url().max(1000)
});

export async function GET() {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ jobs: [], mode: "demo" });
  }
  return NextResponse.json({ jobs: await telegramDownloads.listJobs() });
}

export async function POST(request: Request) {
  try {
    await requireEditor(request);
    const input = requestSchema.parse(await request.json());
    const job = input.source === "telegram"
      ? await telegramDownloads.enqueue(input.url)
      : await webDownloads.enqueue(input.url);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_REQUIRED") {
      return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
    }
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  }
}
