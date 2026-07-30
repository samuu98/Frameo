import { NextResponse } from "next/server";
import { buildAccessWhere, getRequestUser } from "@/lib/access-control";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL || process.env.DEMO_MODE === "true") {
    return NextResponse.json({ folders: [] });
  }
  const user = await getRequestUser(request);
  const grouped = await prisma.mediaAsset.groupBy({
    by: ["directoryKey"],
    where: {
      AND: [buildAccessWhere(user), { directoryKey: { not: null } }]
    },
    orderBy: { directoryKey: "asc" },
    _count: { directoryKey: true }
  });

  const aggregate = new Map<string, number>();
  for (const entry of grouped) {
    if (!entry.directoryKey) continue;
    const parts = entry.directoryKey.split("/").filter(Boolean);
    const key =
      parts[0] === "external" && parts[1] === "library"
        ? parts.slice(0, 3).join("/")
        : parts[0] === "originals"
          ? "originals"
          : parts[0] ?? entry.directoryKey;
    aggregate.set(key, (aggregate.get(key) ?? 0) + entry._count.directoryKey);
  }

  return NextResponse.json({
    folders: [...aggregate.entries()]
      .map(([key, count]) => ({
        key,
        label:
          key === "originals"
            ? "Upload"
            : key.replace(/^external\/library\/?/, ""),
        count
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "it"))
  });
}
