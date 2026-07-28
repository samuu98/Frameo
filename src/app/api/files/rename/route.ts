import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access-control";
import { renameManagedFile } from "@/lib/file-organizer";

export const runtime = "nodejs";

const schema = z.object({
  mediaId: z.string().min(1),
  name: z.string().trim().min(1).max(140),
  confirm: z.literal(true)
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Rinomina non valida o non confermata" }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ media: { id: parsed.data.mediaId, title: parsed.data.name }, mode: "demo" });
  }
  try {
    await requireAdmin(request);
    const media = await renameManagedFile(parsed.data.mediaId, parsed.data.name);
    return NextResponse.json({ media: { ...media, bytes: media.bytes.toString() } });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}
