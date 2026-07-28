import { DuplicateStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const schema = z.object({
  status: z.enum(["KEPT_BOTH", "MERGED", "DISMISSED"])
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Stato non valido" }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ match: { id: (await context.params).id, ...parsed.data }, mode: "demo" });
  }
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    const match = await prisma.duplicateMatch.update({
      where: { id },
      data: { status: parsed.data.status as DuplicateStatus }
    });
    return NextResponse.json({ match });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}
