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
  return NextResponse.json({
    folders: grouped
      .filter(
        (entry): entry is typeof entry & { directoryKey: string } =>
          Boolean(entry.directoryKey)
      )
      .map((entry) => ({
        key: entry.directoryKey,
        label: entry.directoryKey
          .replace(/^external\/library\/?/, "")
          .replace(/^originals\/?/, "Upload / "),
        count: entry._count.directoryKey
      }))
  });
}
