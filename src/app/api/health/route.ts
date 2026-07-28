import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, database: "demo", processor: "available" });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "connected", processor: "available" });
  } catch {
    return NextResponse.json(
      { ok: false, database: "unavailable", processor: "unknown" },
      { status: 503 }
    );
  }
}
