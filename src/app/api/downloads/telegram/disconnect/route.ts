import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/access-control";
import { friendlyError, telegramDownloads } from "@/lib/telegram-downloads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireEditor(request);
    await telegramDownloads.disconnect(true);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_REQUIRED") {
      return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
    }
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  }
}
