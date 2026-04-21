import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import {
  TERMS_VERSION,
  ORGANIZER_TERMS_VERSION,
  PRIVACY_VERSION,
} from "@/lib/legalVersions";

/**
 * POST /api/accept-legal-terms
 * Persists acceptance of current legal versions for the authenticated organizer.
 * Requires an Instant auth refresh token.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return NextResponse.json({ error: "Missing auth token" }, { status: 401 });
    }

    const user = await adminDb.auth.verifyToken(token);
    if (!user?.email) {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    const { $users } = await adminDb.query({
      $users: { $: { where: { email: user.email.toLowerCase() } } },
    });
    const record = $users[0];
    if (!record) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = Date.now();
    await adminDb.transact(
      adminDb.tx.$users[record.id].update({
        acceptedTermsVersion: TERMS_VERSION,
        acceptedTermsAt: now,
        acceptedOrganizerTermsVersion: ORGANIZER_TERMS_VERSION,
        acceptedOrganizerTermsAt: now,
        acceptedPrivacyVersion: PRIVACY_VERSION,
        acceptedPrivacyAt: now,
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[accept-legal-terms] error:", err);
    return NextResponse.json(
      { error: "Failed to persist acceptance" },
      { status: 500 },
    );
  }
}
