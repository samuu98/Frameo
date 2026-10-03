import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/access-control";
import { friendlyError, telegramDownloads } from "@/lib/telegram-downloads";

export const runtime = "nodejs";

const schema = z.object({
  apiId: z.coerce.number().int().positive(),
  apiHash: z.string().trim().min(20).max(128),
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Usa il formato internazionale, per esempio +393331234567")
});

export async function POST(request: Request) {
  try {
    await requireEditor(request);
    const input = schema.parse(await request.json());
    return NextResponse.json(await telegramDownloads.requestCode(input.apiId, input.apiHash, input.phone));
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_REQUIRED") {
      return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
    }
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  }
}
