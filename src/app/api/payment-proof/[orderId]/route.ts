import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessOrder } from "@/lib/authHelpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!authToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await adminDb.auth.verifyToken(authToken);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await params;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const authz = await assertOrganizerCanAccessOrder(user.email, orderId);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { orders } = await adminDb.query({
    orders: { $: { where: { id: orderId } } },
  });
  const order = orders[0];
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const path = order.paymentProofPath as string | undefined;
  if (
    !path ||
    path === "admin-created" ||
    path === "csv-import" ||
    path === "proof-deleted"
  ) {
    return NextResponse.json({ error: "No proof available" }, { status: 404 });
  }

  // Resolve a fresh signed URL via $files (storage URLs expire).
  const { $files } = await adminDb.query({
    $files: { $: { where: { path } } },
  });
  const fileUrl = $files[0]?.url as string | undefined;
  if (!fileUrl) {
    return NextResponse.json({ error: "Proof file missing" }, { status: 404 });
  }

  // Server-side fetch — Vercel can reach the InstantDB CDN even when the
  // browser's network (e.g. Inter VE) blocks it.
  const upstream = await fetch(fileUrl, { cache: "no-store" });
  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Failed to fetch proof" },
      { status: 502 },
    );
  }

  const buffer = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") || "image/jpeg";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    },
  });
}
