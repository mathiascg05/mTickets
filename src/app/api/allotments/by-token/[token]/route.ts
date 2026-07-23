import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";
import { generateTicketViewToken } from "@/lib/ticketViewToken";

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

const PRIVATE_HEADERS = {
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!isValidToken(token)) {
      return NextResponse.json(
        { error: "INVALID_TOKEN" },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }

    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: {
        $: { where: { manageToken: token } },
        items: { ticketType: {} },
        concert: { paymentMethods: {} },
      },
    });
    const a = ticketAllotments[0];
    if (!a || !a.manageToken) {
      return NextResponse.json(
        { error: "TOKEN_REVOKED" },
        { status: 410, headers: PRIVATE_HEADERS },
      );
    }
    if (a.tokenExpiresAt && a.tokenExpiresAt < Date.now()) {
      return NextResponse.json(
        { error: "TOKEN_EXPIRED" },
        { status: 410, headers: PRIVATE_HEADERS },
      );
    }

    const concert = firstOf<{
      id: string;
      name: string;
      date: string;
      venue?: string;
      slug: string;
      flyerUrl?: string;
      logoUrl?: string;
      primaryColor?: string;
      themeColors?: string;
      paymentMethods?: unknown[];
    }>(a.concert);

    const items = (a.items || []).map((it) => {
      const tt = firstOf<{ id: string; name: string }>(it.ticketType);
      return { quantity: it.quantity, ticketTypeName: tt?.name || "" };
    });

    // Payment methods (the host's), shown so the group knows how to pay —
    // mirrors what a normal buyer sees (rate/Bs conversion, structured details).
    const paymentMethods = (concert?.paymentMethods || [])
      .map((pm) => {
        const m = pm as Record<string, unknown>;
        return {
          id: m.id,
          type: m.type,
          name: m.name,
          instructions: m.instructions,
          convertCurrency: m.convertCurrency,
          customRate: m.customRate,
          showConversionDetail: m.showConversionDetail,
          requireReferenceNumber: m.requireReferenceNumber,
          requireScreenshot: m.requireScreenshot,
          zelleEmail: m.zelleEmail,
          zelleName: m.zelleName,
          pmCedula: m.pmCedula,
          pmPhone: m.pmPhone,
          pmBank: m.pmBank,
          createdAt: m.createdAt as number | undefined,
        };
      })
      .sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0));

    // Minted tickets (only once approved), with a per-order view token so the
    // school can render/share each QR without an account.
    let tickets: {
      orderId: string;
      seq: number;
      orderNumber?: string;
      ticketTypeName: string;
      visited: boolean;
      delivered: boolean;
      viewToken: string;
    }[] = [];
    if (a.status === "approved") {
      const { orders } = await adminDb.query({
        orders: {
          $: { where: { allotmentId: a.id } },
          ticketType: {},
        },
      });
      tickets = orders
        .map((o) => {
          const tt = firstOf<{ name: string }>(o.ticketType);
          return {
            orderId: o.id,
            seq: (o.allotmentSeq as number) ?? 0,
            orderNumber: o.orderNumber as string | undefined,
            ticketTypeName: tt?.name || "",
            visited: Boolean(o.visited),
            delivered: Boolean(o.delivered),
            viewToken: generateTicketViewToken(o.id),
          };
        })
        .sort((x, y) => x.seq - y.seq);
    }

    return NextResponse.json(
      {
        allotment: {
          id: a.id,
          schoolName: a.schoolName,
          status: a.status,
          totalPrice: a.totalPrice,
          ticketCount: a.ticketCount,
          contactEmail: a.contactEmail,
          proofReferenceNumber: a.proofReferenceNumber,
          hasProof: Boolean(a.paymentProofPath),
          paymentMethodId: a.paymentMethodId,
        },
        concert: concert
          ? {
              id: concert.id,
              name: concert.name,
              date: concert.date,
              venue: concert.venue,
              slug: concert.slug,
              flyerUrl: concert.flyerUrl,
              logoUrl: concert.logoUrl,
              primaryColor: concert.primaryColor,
              themeColors: concert.themeColors,
            }
          : null,
        items,
        paymentMethods,
        tickets,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (err) {
    console.error("[allotments:by-token] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
