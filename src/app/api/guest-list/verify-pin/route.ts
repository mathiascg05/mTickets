import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { createGuestScannerToken } from "@/lib/guestListScannerToken";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { eventId, pin } = await req.json();
    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }
    if (!pin || typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json({ error: "Invalid pin format" }, { status: 400 });
    }

    const { guestListEvents } = await adminDb.query({
      guestListEvents: { $: { where: { id: eventId } } },
    });
    const event = guestListEvents[0];
    if (!event || !event.scannerPin) {
      return NextResponse.json({ error: "Invalid pin" }, { status: 401 });
    }

    const pinBuf = Buffer.from(pin, "utf-8");
    const storedBuf = Buffer.from(event.scannerPin, "utf-8");
    if (
      pinBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(pinBuf, storedBuf)
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      return NextResponse.json({ error: "Invalid pin" }, { status: 401 });
    }

    const token = createGuestScannerToken(eventId);
    return NextResponse.json({
      token,
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        venue: event.venue,
      },
    });
  } catch (err) {
    console.error("[guest-list/verify-pin] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
