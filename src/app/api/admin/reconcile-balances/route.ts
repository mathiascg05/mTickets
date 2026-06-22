import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isSuperAdmin } from "@/lib/authHelpers";
import { reconcileAllBalances } from "@/lib/reconcileBalances";

// Super-admin-only: recompute every organizer's stored balance from its
// transaction ledger, fixing drift introduced by concurrent approvals. See
// reconcileAllBalances for details. Idempotent.
export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers
      .get("authorization")
      ?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isSuperAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const corrections = await reconcileAllBalances(user.email);
    return NextResponse.json({
      success: true,
      corrected: corrections.length,
      corrections,
    });
  } catch (err) {
    console.error("[admin/reconcile-balances] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
