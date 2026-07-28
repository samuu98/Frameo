import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["ADMIN", "CURATOR", "VIEWER"]).default("VIEWER")
});

const demoUsers = [
  {
    id: "demo-admin",
    name: "Sara Porta",
    email: "admin@frameo.local",
    role: "ADMIN",
    active: true,
    lastSeenAt: new Date().toISOString(),
    accessRules: []
  },
  {
    id: "demo-curator",
    name: "Elena Riva",
    email: "elena@frameo.local",
    role: "CURATOR",
    active: true,
    lastSeenAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    accessRules: [{ effect: "ALLOW", scope: "ALL", targetId: null, label: "Tutta la libreria" }]
  },
  {
    id: "demo-viewer",
    name: "Luca Bianchi",
    email: "luca@frameo.local",
    role: "VIEWER",
    active: true,
    lastSeenAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    accessRules: [{ effect: "ALLOW", scope: "PERSON", targetId: "sofia", label: "Media con Sofia" }]
  }
];

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ users: demoUsers, mode: "demo" });
  }
  try {
    await requireAdmin(request);
    const users = await prisma.appUser.findMany({
      include: { accessRules: { orderBy: { createdAt: "asc" } } },
      orderBy: [{ active: "desc" }, { name: "asc" }]
    });
    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const parsed = createUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Dati utente non validi", issues: parsed.error.issues }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({
      user: { id: `demo-${Date.now()}`, ...parsed.data, active: true, accessRules: [] },
      mode: "demo"
    }, { status: 201 });
  }
  try {
    await requireAdmin(request);
    const user = await prisma.appUser.create({
      data: {
        ...parsed.data,
        role: parsed.data.role as UserRole
      },
      include: { accessRules: true }
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}
