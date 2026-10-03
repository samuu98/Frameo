import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEditor } from "@/lib/access-control";
import { friendlyError, telegramDownloads } from "@/lib/telegram-downloads";

export const runtime = "nodejs";

const schema = z.object({
  code: z.string().trim().max(20).default(""),
  password: z.string().max(256).optional()
}).refine((value) => value.code || value.password, "Inserisci il codice o la password 2FA.");

export async function POST(request: Request) {
  try {
    await requireEditor(request);
    const input = schema.parse(await request.json());
    return NextResponse.json(await telegramDownloads.verify(input.code, input.password));
  } catch (error) {
    if (error instanceof Error && error.message === "EDITOR_REQUIRED") {
      return NextResponse.json({ error: "Permessi di modifica richiesti" }, { status: 403 });
    }
    return NextResponse.json({ error: friendlyError(error) }, { status: 400 });
  }
}
