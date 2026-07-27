import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { verifyTicketViewToken } from "@/lib/ticketViewToken";
import { isAuthorizedForConcert, type ConcertAuthInfo } from "@/lib/authHelpers";

// Returns a buyer's order (+ purchase-group siblings) for the public ticket
// page, but ONLY after authorization. With orders.view locked to owners, the
// ticket page can no longer read orders client-side, so this server route
// (admin SDK bypasses perms) gates access by:
//   - email matching the order's email, OR
//   - a valid HMAC view token (anonymous allotment tickets), OR
//   - a Bearer refresh_token belonging to super admin / the event organizer /
//     a collaborator.
export const dynamic = "force-dynamic";

function unwrap<T>(rel: unknown): T | undefined {
  return (Array.isArray(rel) ? rel[0] : rel) as T | undefined;
}

// The admin SDK returns has-one relations as arrays; the client ticket page
// expects them as single objects (matching db.useQuery). Normalize so the
// returned JSON is shape-compatible with the old client query.
function normalizeOrder(o: Record<string, unknown>): Record<string, unknown> {
  const tt = unwrap<Record<string, unknown>>(o.ticketType);
  if (!tt) return { ...o, ticketType: undefined };
  return {
    ...o,
    ticketType: {
      ...tt,
      concert: unwrap(tt.concert),
      phases: (tt.phases as unknown[]) ?? [],
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const { orderId, email, viewToken } = await req.json();
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ authorized: false }, { status: 400 });
    }

    const { orders } = await adminDb.query({
      orders: {
        $: { where: { id: orderId } },
        ticketType: {
          concert: { collaborators: {} },
          phases: {},
        },
      },
    });
    const order = orders[0];
    if (!order) {
      // Don't reveal existence.
      return NextResponse.json({ authorized: false });
    }

    // Resolve the concert for Bearer-based authorization.
    const ticketType = unwrap<{ concert: unknown }>(order.ticketType);
    const concert = unwrap<ConcertAuthInfo & { id: string }>(
      ticketType?.concert,
    );

    // Authorization
    let authorized = false;
    if (viewToken && typeof viewToken === "string") {
      authorized =
        Boolean(order.allotmentId) && verifyTicketViewToken(orderId, viewToken);
    } else if (email && typeof email === "string") {
      authorized =
        (order.email ?? "").trim().toLowerCase() ===
        email.trim().toLowerCase();
    }
    if (!authorized) {
      const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
      if (bearer) {
        const user = await adminDb.auth.verifyToken(bearer).catch(() => null);
        if (user?.email && concert) {
          authorized = isAuthorizedForConcert(user.email, concert);
        }
      }
    }
    if (!authorized) {
      return NextResponse.json({ authorized: false });
    }

    // Purchase-group siblings — never for allotment orders (privacy: a lot
    // participant must not see the other tickets in the lot).
    let siblings: unknown[] = [];
    const groupId = order.allotmentId ? undefined : order.purchaseGroupId;
    if (groupId) {
      const { orders: group } = await adminDb.query({
        orders: {
          $: { where: { purchaseGroupId: groupId } },
          ticketType: { phases: {} },
        },
      });
      siblings = group.map((o) => normalizeOrder(o));
    }

    return NextResponse.json({
      authorized: true,
      order: normalizeOrder(order),
      siblings,
    });
  } catch (err) {
    console.error("[order/view] Error:", err);
    return NextResponse.json({ authorized: false }, { status: 500 });
  }
}
