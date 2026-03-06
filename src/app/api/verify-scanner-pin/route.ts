import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { createScannerToken } from "@/lib/scannerToken";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { concertId, pin } = await req.json();

    if (!concertId || typeof concertId !== "string") {
      return NextResponse.json(
        { error: "concertId is required" },
        { status: 400 },
      );
    }

    if (!pin || typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: "PIN must be 4-6 digits" },
        { status: 400 },
      );
    }

    const { concerts } = await adminDb.query({
      concerts: { $: { where: { id: concertId } } },
    });

    const concert = concerts[0];
    if (!concert || !concert.scannerPin) {
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 401 },
      );
    }

    // Constant-time comparison
    const pinBuf = Buffer.from(pin, "utf-8");
    const storedBuf = Buffer.from(concert.scannerPin, "utf-8");
    if (
      pinBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(pinBuf, storedBuf)
    ) {
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 401 },
      );
    }

    const token = createScannerToken(concertId);

    return NextResponse.json({
      token,
      concert: {
        id: concert.id,
        name: concert.name,
        date: concert.date,
        venue: concert.venue,
      },
    });
  } catch (err) {
    console.error("[verify-scanner-pin] Error:", err);
    return NextResponse.json(
      { error: "Failed to verify PIN" },
      { status: 500 },
    );
  }
}
