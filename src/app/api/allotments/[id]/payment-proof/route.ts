import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!authToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await adminDb.auth.verifyToken(authToken);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { ticketAllotments } = await adminDb.query({
    ticketAllotments: {
      $: { where: { id } },
      concert: { collaborators: {} },
    },
  });
  const allotment = ticketAllotments[0];
  if (!allotment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const concert = firstOf<{
    organizerEmail: string;
    collaborators?: { email: string }[];
  }>(allotment.concert);
  if (!concert || !isAuthorizedForConcert(user.email, concert)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const path = allotment.paymentProofPath as string | undefined;
  if (!path || path === "proof-deleted") {
    return NextResponse.json({ error: "No proof available" }, { status: 404 });
  }

  const { $files } = await adminDb.query({ $files: { $: { where: { path } } } });
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
    headers: { "Content-Type": contentType, "Cache-Control": "private, no-store" },
  });
}
