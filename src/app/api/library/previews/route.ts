import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access-control";
import {
  cancelPreviewQueue,
  getPreviewQueueStatus,
  startPreviewQueue
} from "@/lib/preview-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  mode: z
    .enum([
      "MISSING_THUMBNAIL",
      "MISSING_PREVIEW",
      "MISSING_ANY",
      "REGENERATE"
    ])
    .default("MISSING_ANY"),
  kind: z.enum(["VIDEO", "IMAGE", "ALL"]).default("VIDEO"),
  limit: z.number().int().min(1).max(10_000).optional(),
  ids: z.array(z.string().min(1)).max(500).optional()
});

async function requirePreviewAdmin(request: Request) {
  try {
    await requireAdmin(request);
    return null;
  } catch {
    return NextResponse.json(
      { error: "Permessi amministratore richiesti" },
      { status: 403 }
    );
  }
}

export async function GET(request: Request) {
  const denied = await requirePreviewAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ previews: getPreviewQueueStatus() });
}

export async function POST(request: Request) {
  const denied = await requirePreviewAdmin(request);
  if (denied) return denied;
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Richiesta anteprime non valida", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const previews = await startPreviewQueue(parsed.data);
  return NextResponse.json({ previews }, { status: 202 });
}

export async function DELETE(request: Request) {
  const denied = await requirePreviewAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ previews: cancelPreviewQueue() });
}
