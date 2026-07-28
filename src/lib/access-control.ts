import {
  AccessEffect,
  AccessScope,
  type AppUser,
  type Prisma,
  UserRole
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type RequestUser = AppUser & {
  accessRules: Array<{
    effect: AccessEffect;
    scope: AccessScope;
    targetId: string | null;
  }>;
};

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") return null;
  const explicitId = request.headers.get("x-frameo-user-id");
  const cookieId = request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("frameo_user="))
    ?.split("=")[1];

  if (explicitId || cookieId) {
    return prisma.appUser.findFirst({
      where: { id: explicitId ?? cookieId, active: true },
      include: { accessRules: true }
    });
  }

  return prisma.appUser.findFirst({
    where: { role: UserRole.ADMIN, active: true },
    include: { accessRules: true },
    orderBy: { createdAt: "asc" }
  });
}

const scopeToWhere = (
  scope: AccessScope,
  targetId: string | null
): Prisma.MediaAssetWhereInput | null => {
  if (scope === AccessScope.ALL) return {};
  if (!targetId) return null;
  if (scope === AccessScope.MEDIA) return { id: targetId };
  if (scope === AccessScope.PERSON) {
    return { people: { some: { personId: targetId } } };
  }
  if (scope === AccessScope.TAG) {
    return { tags: { some: { tagId: targetId } } };
  }
  if (scope === AccessScope.GROUP) {
    return { groups: { some: { groupId: targetId } } };
  }
  return null;
};

export function buildAccessWhere(user: RequestUser | null): Prisma.MediaAssetWhereInput {
  if (!user || user.role === UserRole.ADMIN) return {};

  const allow = user.accessRules
    .filter(({ effect }) => effect === AccessEffect.ALLOW)
    .map(({ scope, targetId }) => scopeToWhere(scope, targetId))
    .filter((rule): rule is Prisma.MediaAssetWhereInput => Boolean(rule));
  const deny = user.accessRules
    .filter(({ effect }) => effect === AccessEffect.DENY)
    .map(({ scope, targetId }) => scopeToWhere(scope, targetId))
    .filter((rule): rule is Prisma.MediaAssetWhereInput => Boolean(rule));

  const allowWhere: Prisma.MediaAssetWhereInput =
    allow.length > 0
      ? { OR: allow }
      : user.role === UserRole.CURATOR
        ? {}
        : { id: "__no_media_without_an_allow_rule__" };

  return deny.length > 0
    ? { AND: [allowWhere, { NOT: { OR: deny } }] }
    : allowWhere;
}

export async function requireAdmin(request: Request) {
  const user = await getRequestUser(request);
  if (!user || user.role !== UserRole.ADMIN) {
    throw new Error("ADMIN_REQUIRED");
  }
  return user;
}

export async function requireEditor(request: Request) {
  const user = await getRequestUser(request);
  if (
    !user ||
    (user.role !== UserRole.ADMIN && user.role !== UserRole.CURATOR)
  ) {
    throw new Error("EDITOR_REQUIRED");
  }
  return user;
}
