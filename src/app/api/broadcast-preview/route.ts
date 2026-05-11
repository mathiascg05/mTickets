import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { resolveRecipients, type BroadcastFilters } from "@/lib/broadcastRecipients";

const SAMPLE_SIZE = 20;

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { concertId, filters } = (await req.json()) as {
      concertId: string;
      filters: BroadcastFilters;
    };

    if (!isValidUUID(concertId)) {
      return NextResponse.json({ error: "Invalid concert ID." }, { status: 400 });
    }

    // Authorize: user must own this concert (organizer/collaborator/super admin).
    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
        collaborators: {},
      },
    });
    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json({ error: "Concert not found." }, { status: 404 });
    }
    if (
      !isAuthorizedForConcert(user.email, {
        organizerEmail: concert.organizerEmail,
        collaborators: concert.collaborators,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const safeFilters: BroadcastFilters = {
      ticketTypeIds: Array.isArray(filters?.ticketTypeIds) ? filters.ticketTypeIds : [],
      paymentMethodTypes: Array.isArray(filters?.paymentMethodTypes)
        ? filters.paymentMethodTypes
        : [],
      orderStatuses: Array.isArray(filters?.orderStatuses) ? filters.orderStatuses : [],
    };

    const { recipients, suppressedEmails } = await resolveRecipients(concertId, safeFilters);

    return NextResponse.json({
      totalCount: recipients.length,
      suppressedCount: suppressedEmails.length,
      sample: recipients.slice(0, SAMPLE_SIZE),
    });
  } catch (err) {
    console.error("[broadcast-preview] error:", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
