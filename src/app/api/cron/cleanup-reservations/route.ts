import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";

export async function GET(req: NextRequest) {
  // Verify Vercel cron secret — mandatory
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { reservations } = await adminDb.query({
      reservations: {},
    });

    const now = Date.now();
    const expired = reservations.filter(
      (r: { expiresAt: number }) => r.expiresAt < now,
    );

    if (expired.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    const txns = expired.map((r: { id: string }) =>
      adminDb.tx.reservations[r.id].delete(),
    );

    await adminDb.transact(txns);

    console.log(`[cleanup-reservations] Deleted ${expired.length} expired reservations`);
    return NextResponse.json({ deleted: expired.length });
  } catch (err) {
    console.error("[cleanup-reservations] Error:", err);
    return NextResponse.json(
      { error: "Failed to clean up reservations" },
      { status: 500 },
    );
  }
}
