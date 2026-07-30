import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/access-control";
import {
  getExternalScanStatus,
  startExternalLibraryScan
} from "@/lib/external-library-scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requireScanAdmin = async (request: Request) => {
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
  const denied = await requireScanAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ scan: getExternalScanStatus() });
}

export async function POST(request: Request) {
  const denied = await requireScanAdmin(request);
  if (denied) return denied;
  return NextResponse.json({ scan: startExternalLibraryScan() }, { status: 202 });
}
