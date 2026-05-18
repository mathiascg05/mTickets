import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessGuestListEvent } from "@/lib/guestListAuth";
import { generateInviteToken } from "@/lib/guestListTokens";
import { isValidEmail, isValidCedula, isValidName } from "@/lib/validation";
import { personKey } from "@/lib/guestListDedup";

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

    const body = await req.json();
    const eventId = body.eventId;
    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }

    const auth = await assertOrganizerCanAccessGuestListEvent(user.email, eventId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const email = body.email?.trim().toLowerCase() || undefined;
    const cedula = body.cedula?.trim() || undefined;
    const firstName = body.firstName?.trim() || undefined;
    const lastName = body.lastName?.trim() || undefined;
    const priceOverride =
      typeof body.priceOverride === "number" ? body.priceOverride : undefined;
    const ticketTypeId =
      typeof body.ticketTypeId === "string" ? body.ticketTypeId : undefined;

    if (!email && !cedula) {
      return NextResponse.json(
        { error: "email or cedula required" },
        { status: 400 },
      );
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    if (cedula && !isValidCedula(cedula)) {
      return NextResponse.json({ error: "Invalid cedula" }, { status: 400 });
    }
    if (firstName && !isValidName(firstName)) {
      return NextResponse.json({ error: "Invalid first name" }, { status: 400 });
    }
    if (lastName && !isValidName(lastName)) {
      return NextResponse.json({ error: "Invalid last name" }, { status: 400 });
    }
    if (priceOverride !== undefined && (!Number.isFinite(priceOverride) || priceOverride < 0)) {
      return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    }

    // Dedup: email may repeat as long as firstName + lastName differ;
    // cedula remains globally unique within the list.
    const { guestListEntries: existing } = await adminDb.query({
      guestListEntries: { $: { where: { "event.id": eventId } } },
    });
    const newKey = personKey(email, firstName, lastName);
    for (const e of existing as {
      email?: string;
      cedula?: string;
      firstName?: string;
      lastName?: string;
    }[]) {
      if (
        newKey &&
        personKey(e.email, e.firstName, e.lastName) === newKey
      ) {
        return NextResponse.json(
          { error: "Email + name already in list" },
          { status: 409 },
        );
      }
      if (cedula && e.cedula === cedula) {
        return NextResponse.json(
          { error: "Cedula already in list" },
          { status: 409 },
        );
      }
    }

    // Validate ticket type belongs to this event if provided
    let resolvedTicketTypeId: string | undefined;
    if (ticketTypeId) {
      const { guestListTicketTypes } = await adminDb.query({
        guestListTicketTypes: {
          $: { where: { id: ticketTypeId, "event.id": eventId } },
        },
      });
      if (guestListTicketTypes.length === 0) {
        return NextResponse.json({ error: "Invalid ticket type" }, { status: 400 });
      }
      resolvedTicketTypeId = ticketTypeId;
    }

    const entryId = genId();
    const fields: Record<string, unknown> = {
      status: "invited",
      inviteToken: generateInviteToken(),
      createdAt: Date.now(),
    };
    if (email) fields.email = email;
    if (cedula) fields.cedula = cedula;
    if (firstName) fields.firstName = firstName;
    if (lastName) fields.lastName = lastName;
    if (priceOverride !== undefined) {
      fields.priceOverride = Math.round(priceOverride * 100) / 100;
    }

    const tx = adminDb.tx.guestListEntries[entryId]
      .update(fields)
      .link({ event: eventId });

    await adminDb.transact([
      resolvedTicketTypeId ? tx.link({ ticketType: resolvedTicketTypeId }) : tx,
    ]);

    return NextResponse.json({ id: entryId });
  } catch (err) {
    console.error("[guest-list/add-entry] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
