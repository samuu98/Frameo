import { FileOperationKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access-control";
import {
  buildOrganizationPlan,
  executeOrganizationPlan
} from "@/lib/file-organizer";

export const runtime = "nodejs";

const schema = z.object({
  mediaIds: z.array(z.string().min(1)).min(1).max(500),
  personName: z.string().trim().min(1).max(120),
  action: z.enum(["PREVIEW", "EXECUTE"]).default("PREVIEW"),
  mode: z.enum(["MOVE", "COPY"]).default("MOVE"),
  confirmToken: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Piano filesystem non valido", issues: parsed.error.issues }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    const plan = parsed.data.mediaIds.map((mediaId, index) => ({
      mediaId,
      title: `Media ${index + 1}`,
      sourcePath: `originals/${mediaId}/source.mp4`,
      targetPath: `organized/people/${parsed.data.personName}/media-${index + 1}.mp4`
    }));
    return NextResponse.json({ plan, destructive: parsed.data.mode === "MOVE", mode: "demo" });
  }
  try {
    const user = await requireAdmin(request);
    const plan = await buildOrganizationPlan(parsed.data.mediaIds, parsed.data.personName);
    if (parsed.data.action === "PREVIEW") {
      return NextResponse.json({
        plan: plan.map(({ sourceAbsolute: _source, targetAbsolute: _target, ...item }) => item),
        destructive: parsed.data.mode === "MOVE"
      });
    }
    if (parsed.data.mode === "MOVE" && parsed.data.confirmToken !== "SPOSTA") {
      return NextResponse.json({
        error: "Conferma richiesta: invia confirmToken=SPOSTA per eliminare i path originali"
      }, { status: 409 });
    }
    const operationIds = await executeOrganizationPlan(
      plan,
      parsed.data.mode as FileOperationKind,
      user
    );
    return NextResponse.json({ ok: true, operationIds });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}
