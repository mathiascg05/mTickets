import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isSuperAdmin } from "@/lib/authHelpers";

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
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  const { guestListOrders } = await adminDb.query({
    guestListOrders: {
      $: { where: { id: orderId } },
      entry: { event: {} },
    },
  });
  const order = guestListOrders[0];
  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rawEntry = order.entry as unknown;
  const entry = (Array.isArray(rawEntry) ? rawEntry[0] : rawEntry) as
    | { event: unknown }
    | undefined;
  const rawEvent = entry?.event as unknown;
  const event = (Array.isArray(rawEvent) ? rawEvent[0] : rawEvent) as
    | { organizerEmail: string }
    | undefined;
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const lower = user.email.toLowerCase();
  if (event.organizerEmail.toLowerCase() !== lower && !isSuperAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const path = (order as { paymentProofPath?: string }).paymentProofPath;
  if (!path || path === "proof-deleted") {
    return NextResponse.json({ error: "No proof available" }, { status: 404 });
  }

  const { $files } = await adminDb.query({
    $files: { $: { where: { path } } },
  });
  const fileUrl = $files[0]?.url as string | undefined;
  if (!fileUrl) {
    return NextResponse.json({ error: "Proof file missing" }, { status: 404 });
  }

  const upstream = await fetch(fileUrl, { cache: "no-store" });
  if (!upstream.ok) {
    return NextResponse.json({ error: "Failed to fetch proof" }, { status: 502 });
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
