import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/access-control";
import {
  getStashSyncStatus,
  startStashCatalogSync
} from "@/lib/stash-catalog-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requireStashAdmin = async (request: Request) => {
  try {
    await requireAdmin(request);
    return null;
  } catch {
    return NextResponse.json(
      { error: "Permessi amministratore richiesti" },
      { status: 403 }
    );
  }
};

export async function GET(request: Request) {
  const denied = await requireStashAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ sync: getStashSyncStatus() });
}

export async function POST(request: Request) {
  const denied = await requireStashAdmin(request);
  if (denied) return denied;
  const sync = startStashCatalogSync();
  if (!sync.configured) {
    return NextResponse.json(
      { error: "Collegamento Stash non configurato", sync },
      { status: 409 }
    );
  }
  return NextResponse.json({ sync }, { status: 202 });
}
