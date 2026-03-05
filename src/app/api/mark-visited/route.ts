import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || "";

export async function POST(req: NextRequest) {
  try {
    const { orderId, userEmail } = await req.json();

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    // Verify the caller is an admin
    if (!ADMIN_EMAIL || !userEmail || userEmail.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await adminDb.transact(
      adminDb.tx.orders[orderId].update({ visited: true }),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[mark-visited] Error:", err);
    return NextResponse.json(
      { error: "Failed to mark as visited" },
      { status: 500 },
    );
  }
}
