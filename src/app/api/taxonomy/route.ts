import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      people: ["Sofia", "Luca", "Elena", "Jonas"],
      tags: ["viaggio", "estate", "drone", "ritratto", "architettura", "portfolio"],
      groups: ["Australia 2026", "Portraits", "Urban studies", "Da catalogare"],
      mode: "demo"
    });
  }
  const [people, tags, groups] = await Promise.all([
    prisma.person.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.tag.findMany({ select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
    prisma.group.findMany({ select: { id: true, name: true, accent: true }, orderBy: { name: "asc" } })
  ]);
  return NextResponse.json({ people, tags, groups });
}
