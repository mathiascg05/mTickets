import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID, isValidEmail, isValidName } from "@/lib/validation";

// In-memory rate limit: 3 messages per email per 10 minutes
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 10 * 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { concertId, firstName, lastName, email, subject, body: messageBody } = body;

    if (!isValidUUID(concertId)) {
      return NextResponse.json({ error: "Invalid event." }, { status: 400 });
    }
    if (!isValidName(firstName)) {
      return NextResponse.json({ error: "Invalid first name." }, { status: 400 });
    }
    if (!isValidName(lastName)) {
      return NextResponse.json({ error: "Invalid last name." }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email." }, { status: 400 });
    }
    if (typeof subject !== "string" || subject.trim().length === 0 || subject.length > 200) {
      return NextResponse.json({ error: "Subject is required (max 200 chars)." }, { status: 400 });
    }
    if (typeof messageBody !== "string" || messageBody.trim().length === 0 || messageBody.length > 2000) {
      return NextResponse.json({ error: "Message is required (max 2000 chars)." }, { status: 400 });
    }

    const normalizedEmail = (email as string).toLowerCase().trim();

    if (!checkRateLimit(normalizedEmail)) {
      return NextResponse.json(
        { error: "Too many messages. Please try again later." },
        { status: 429 },
      );
    }

    const { concerts } = await adminDb.query({
      concerts: { $: { where: { id: concertId } } },
    });
    const concertForContact = concerts[0];
    if (!concertForContact || concertForContact.status !== "active") {
      return NextResponse.json(
        { error: "Event is not available." },
        { status: 404 },
      );
    }

    const messageId = id();
    await adminDb.transact(
      adminDb.tx.messages[messageId]
        .create({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: normalizedEmail,
          subject: subject.trim(),
          body: messageBody.trim(),
          status: "new",
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[contact-organizer] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
