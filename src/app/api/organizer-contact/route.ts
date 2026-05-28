import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidName, isValidPhone } from "@/lib/validation";
import { errorResponse } from "@/lib/serverI18n";

/**
 * POST /api/organizer-contact
 * Persists the organizer's contact info (name + phone) on $users.
 * Used by existing accounts that registered before these fields existed.
 * Requires an Instant auth refresh token.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }

    const authUser = await adminDb.auth.verifyToken(token);
    if (!authUser?.email) {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }

    const { firstName, lastName, phone } = await req.json();
    if (!isValidName(firstName)) {
      return errorResponse(req, "INVALID_FIRST_NAME", 400);
    }
    if (!isValidName(lastName)) {
      return errorResponse(req, "INVALID_LAST_NAME", 400);
    }
    if (!isValidPhone(phone)) {
      return errorResponse(req, "INVALID_PHONE", 400);
    }

    const { $users } = await adminDb.query({
      $users: { $: { where: { email: authUser.email.toLowerCase() } } },
    });
    const record = $users[0];
    if (!record) {
      return errorResponse(req, "INTERNAL_ERROR", 404);
    }

    await adminDb.transact(
      adminDb.tx.$users[record.id].update({
        firstName: (firstName as string).trim(),
        lastName: (lastName as string).trim(),
        phone: (phone as string).trim(),
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[organizer-contact] error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
