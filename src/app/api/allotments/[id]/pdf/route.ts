import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { buildAllotmentPdf, type AllotmentTicket } from "@/lib/allotmentPdf";

export const maxDuration = 60;

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

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
      id: string;
      organizerEmail: string;
      collaborators?: { email: string }[];
    }>(allotment.concert);
    if (!concert) {
      return NextResponse.json({ error: "Concert not found" }, { status: 404 });
    }

    // Access: the school's valid manage token, or an authorized organizer.
    let authorized = false;
    if (token && allotment.manageToken && token === allotment.manageToken) {
      const notExpired =
        !allotment.tokenExpiresAt || allotment.tokenExpiresAt > Date.now();
      authorized = notExpired;
    } else {
      const authToken = req.headers
        .get("authorization")
        ?.replace("Bearer ", "");
      if (authToken) {
        const user = await adminDb.auth.verifyToken(authToken);
        if (user?.email && isAuthorizedForConcert(user.email, concert)) {
          authorized = true;
        }
      }
    }
    if (!authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (allotment.status !== "approved") {
      return NextResponse.json({ error: "NOT_APPROVED" }, { status: 409 });
    }

    const { orders } = await adminDb.query({
      orders: { $: { where: { allotmentId: id } }, ticketType: {} },
    });
    const tickets: AllotmentTicket[] = orders
      .map((o) => {
        const tt = firstOf<{ name: string }>(o.ticketType);
        const seq = (o.allotmentSeq as number) ?? 0;
        return {
          seq,
          orderId: o.id,
          label: `#${pad(seq)}${tt?.name ? ` ${tt.name}` : ""}`,
        };
      })
      .sort((a, b) => a.seq - b.seq)
      .map(({ orderId, label }) => ({ orderId, label }));

    if (tickets.length === 0) {
      return NextResponse.json({ error: "No tickets" }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const pdfBytes = await buildAllotmentPdf(appUrl, tickets);

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="lote-${id}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[allotments:pdf] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
