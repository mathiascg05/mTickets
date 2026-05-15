import { NextRequest, NextResponse } from "next/server";
import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessGuestListEvent } from "@/lib/guestListAuth";
import { generateInviteToken } from "@/lib/guestListTokens";
import { isValidEmail, isValidCedula } from "@/lib/validation";

type UploadEntry = {
  email?: string;
  cedula?: string;
  firstName?: string;
  lastName?: string;
  priceOverride?: number;
  ticketTypeName?: string;
};

const MAX_BATCH = 5000;

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

    const {
      eventId,
      entries,
      defaultTicketTypeId,
    }: {
      eventId: string;
      entries: UploadEntry[];
      defaultTicketTypeId?: string;
    } = await req.json();
    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: "entries required" }, { status: 400 });
    }
    if (entries.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Too many entries (max ${MAX_BATCH})` },
        { status: 400 },
      );
    }

    const auth = await assertOrganizerCanAccessGuestListEvent(user.email, eventId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Load existing entries to dedup + load ticket types of this event
    const [{ guestListEntries: existing }, { guestListTicketTypes }] =
      await Promise.all([
        adminDb.query({
          guestListEntries: { $: { where: { "event.id": eventId } } },
        }),
        adminDb.query({
          guestListTicketTypes: { $: { where: { "event.id": eventId } } },
        }),
      ]);

    const ticketTypes = guestListTicketTypes as { id: string; name: string }[];
    const ttByLowerName = new Map<string, string>();
    for (const tt of ticketTypes) {
      ttByLowerName.set(tt.name.toLowerCase(), tt.id);
    }
    const fallbackTicketTypeId =
      defaultTicketTypeId && ticketTypes.find((t) => t.id === defaultTicketTypeId)
        ? defaultTicketTypeId
        : ticketTypes[0]?.id;
    const existingEmails = new Set<string>();
    const existingCedulas = new Set<string>();
    for (const e of existing as { email?: string; cedula?: string }[]) {
      if (e.email) existingEmails.add(e.email.toLowerCase());
      if (e.cedula) existingCedulas.add(e.cedula);
    }

    const seenEmails = new Set<string>();
    const seenCedulas = new Set<string>();
    const skipped: { reason: string; entry: UploadEntry }[] = [];
    const txns = [];
    let inserted = 0;

    for (const raw of entries) {
      const email = raw.email?.trim().toLowerCase() || undefined;
      const cedula = raw.cedula?.trim() || undefined;
      if (!email && !cedula) {
        skipped.push({ reason: "missing_email_and_cedula", entry: raw });
        continue;
      }
      if (email && !isValidEmail(email)) {
        skipped.push({ reason: "invalid_email", entry: raw });
        continue;
      }
      if (cedula && !isValidCedula(cedula)) {
        skipped.push({ reason: "invalid_cedula", entry: raw });
        continue;
      }
      if (email && (existingEmails.has(email) || seenEmails.has(email))) {
        skipped.push({ reason: "duplicate_email", entry: raw });
        continue;
      }
      if (cedula && (existingCedulas.has(cedula) || seenCedulas.has(cedula))) {
        skipped.push({ reason: "duplicate_cedula", entry: raw });
        continue;
      }
      if (
        raw.priceOverride !== undefined &&
        (!Number.isFinite(raw.priceOverride) || raw.priceOverride < 0)
      ) {
        skipped.push({ reason: "invalid_price", entry: raw });
        continue;
      }

      if (email) seenEmails.add(email);
      if (cedula) seenCedulas.add(cedula);

      // Resolve ticket type: explicit name → fallback default
      let ticketTypeId: string | undefined;
      if (raw.ticketTypeName?.trim()) {
        ticketTypeId = ttByLowerName.get(raw.ticketTypeName.trim().toLowerCase());
        if (!ticketTypeId) {
          skipped.push({ reason: "unknown_ticket_type", entry: raw });
          continue;
        }
      } else {
        ticketTypeId = fallbackTicketTypeId;
      }

      const entryId = genId();
      const fields: Record<string, unknown> = {
        status: "invited",
        inviteToken: generateInviteToken(),
        createdAt: Date.now(),
      };
      if (email) fields.email = email;
      if (cedula) fields.cedula = cedula;
      if (raw.firstName?.trim()) fields.firstName = raw.firstName.trim();
      if (raw.lastName?.trim()) fields.lastName = raw.lastName.trim();
      if (typeof raw.priceOverride === "number") {
        fields.priceOverride = Math.round(raw.priceOverride * 100) / 100;
      }

      const tx = adminDb.tx.guestListEntries[entryId]
        .update(fields)
        .link({ event: eventId });

      txns.push(
        ticketTypeId ? tx.link({ ticketType: ticketTypeId }) : tx,
      );
      inserted++;
    }

    // Batch transactions in chunks of 100 to keep payloads manageable
    const CHUNK = 100;
    for (let i = 0; i < txns.length; i += CHUNK) {
      await adminDb.transact(txns.slice(i, i + CHUNK));
    }

    return NextResponse.json({
      inserted,
      skipped: skipped.length,
      skippedDetails: skipped.slice(0, 50),
    });
  } catch (err) {
    console.error("[guest-list/upload] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
