import { NextResponse } from "next/server";
import { friendlyError, telegramDownloads } from "@/lib/telegram-downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ telegram: await telegramDownloads.status() });
  } catch (error) {
    return NextResponse.json({ telegram: { connected: false }, error: friendlyError(error) });
  }
}
