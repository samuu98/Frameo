import { AccessEffect, AccessScope, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ruleSchema = z.object({
  effect: z.enum(["ALLOW", "DENY"]),
  scope: z.enum(["ALL", "MEDIA", "PERSON", "TAG", "GROUP"]),
  targetId: z.string().trim().min(1).nullable().optional(),
  label: z.string().trim().max(160).nullable().optional()
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["ADMIN", "CURATOR", "VIEWER"]).optional(),
  active: z.boolean().optional(),
  accessRules: z.array(ruleSchema).max(100).optional()
});

type SubmittedRule = z.infer<typeof ruleSchema>;

async function resolveRuleTarget(rule: SubmittedRule) {
  if (rule.scope === "ALL") return { ...rule, targetId: null };
  const targetId = rule.targetId ?? "";
  const label = rule.label ?? "";
  const stringMatch = (field: "name" | "title") => ({
    OR: [
      ...(targetId ? [{ id: targetId }] : []),
      ...(label ? [{ [field]: { equals: label, mode: "insensitive" as const } }] : [])
    ]
  });

  const target =
    rule.scope === "PERSON"
      ? await prisma.person.findFirst({ where: stringMatch("name"), select: { id: true, name: true } })
      : rule.scope === "TAG"
        ? await prisma.tag.findFirst({ where: stringMatch("name"), select: { id: true, name: true } })
        : rule.scope === "GROUP"
          ? await prisma.group.findFirst({ where: stringMatch("name"), select: { id: true, name: true } })
          : await prisma.mediaAsset.findFirst({ where: stringMatch("title"), select: { id: true, title: true } });

  if (!target) throw new Error(`ACCESS_TARGET_NOT_FOUND:${label || targetId}`);
  const resolvedLabel = "name" in target ? target.name : target.title;
  return { ...rule, targetId: target.id, label: rule.label ?? resolvedLabel };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const parsed = updateUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Regole non valide", issues: parsed.error.issues }, { status: 422 });
  }
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ user: { id: (await context.params).id, ...parsed.data }, mode: "demo" });
  }
  try {
    await requireAdmin(request);
    const { id } = await context.params;
    const { accessRules, role, ...fields } = parsed.data;
    const resolvedRules = accessRules
      ? await Promise.all(accessRules.map(resolveRuleTarget))
      : undefined;
    const user = await prisma.appUser.update({
      where: { id },
      data: {
        ...fields,
        ...(role ? { role: role as UserRole } : {}),
        ...(resolvedRules
          ? {
              accessRules: {
                deleteMany: {},
                create: resolvedRules.map((rule) => ({
                  effect: rule.effect as AccessEffect,
                  scope: rule.scope as AccessScope,
                  targetId: rule.scope === "ALL" ? null : rule.targetId,
                  label: rule.label
                }))
              }
            }
          : {})
      },
      include: { accessRules: true }
    });
    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    if (error instanceof Error && error.message.startsWith("ACCESS_TARGET_NOT_FOUND:")) {
      return NextResponse.json({
        error: `Destinazione accesso non trovata: ${error.message.split(":").slice(1).join(":")}`
      }, { status: 422 });
    }
    throw error;
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ ok: true, mode: "demo" });
  }
  try {
    const admin = await requireAdmin(request);
    const { id } = await context.params;
    if (admin.id === id) {
      return NextResponse.json({ error: "Non puoi disattivare il tuo account" }, { status: 409 });
    }
    await prisma.appUser.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_REQUIRED") {
      return NextResponse.json({ error: "Permessi amministratore richiesti" }, { status: 403 });
    }
    throw error;
  }
}
