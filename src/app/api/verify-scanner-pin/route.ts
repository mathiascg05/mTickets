import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { createScannerToken } from "@/lib/scannerToken";
import { errorResponse } from "@/lib/serverI18n";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { concertId, pin } = await req.json();

    if (!concertId || typeof concertId !== "string") {
      return errorResponse(req, "CONCERT_ID_REQUIRED", 400);
    }

    if (!pin || typeof pin !== "string" || !/^\d{4,6}$/.test(pin)) {
      return errorResponse(req, "PIN_FORMAT", 400);
    }

    const { concerts } = await adminDb.query({
      concerts: { $: { where: { id: concertId } } },
    });

    const concert = concerts[0];
    if (!concert || !concert.scannerPin) {
      return errorResponse(req, "INVALID_PIN", 401);
    }

    // Constant-time comparison
    const pinBuf = Buffer.from(pin, "utf-8");
    const storedBuf = Buffer.from(concert.scannerPin, "utf-8");
    if (
      pinBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(pinBuf, storedBuf)
    ) {
      // Brute-force deterrent: delay wrong PIN responses
      await new Promise((r) => setTimeout(r, 1000));
      return errorResponse(req, "INVALID_PIN", 401);
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
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
