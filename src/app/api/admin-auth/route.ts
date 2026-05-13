import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/password";
import { errorResponse } from "@/lib/serverI18n";
import {
  TERMS_VERSION,
  ORGANIZER_TERMS_VERSION,
  PRIVACY_VERSION,
} from "@/lib/legalVersions";

/** POST /api/admin-auth — check if email exists (login vs register) */
export async function POST(req: NextRequest) {
  try {
    const { email, action } = await req.json();

    if (typeof email !== "string" || !email.includes("@")) {
      return errorResponse(req, "INVALID_EMAIL", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const mode = action === "register" ? "register" : "login";

    const { $users } = await adminDb.query({
      $users: { $: { where: { email: normalizedEmail } } },
    });
    const userExists = $users.length > 0;

    if (mode === "login" && !userExists) {
      return errorResponse(req, "NO_ACCOUNT", 404);
    }

    if (mode === "register" && userExists) {
      return errorResponse(req, "ACCOUNT_EXISTS", 409);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin-auth] Check error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}

/** PUT /api/admin-auth — register or login with password */
export async function PUT(req: NextRequest) {
  try {
    const {
      email,
      password,
      confirmPassword,
      action,
      acceptedTermsVersion,
      acceptedOrganizerTermsVersion,
      acceptedPrivacyVersion,
    } = await req.json();

    if (typeof email !== "string" || !email.includes("@")) {
      return errorResponse(req, "INVALID_INPUT", 400);
    }
    if (typeof password !== "string" || !password) {
      return errorResponse(req, "PASSWORD_REQUIRED", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── Registration ──
    if (action === "register") {
      const passwordError = validatePassword(password);
      if (passwordError) {
        return errorResponse(req, passwordError.code, 400, { values: passwordError.values });
      }
      if (password !== confirmPassword) {
        return errorResponse(req, "PASSWORDS_MISMATCH", 400);
      }
      if (
        acceptedTermsVersion !== TERMS_VERSION ||
        acceptedOrganizerTermsVersion !== ORGANIZER_TERMS_VERSION ||
        acceptedPrivacyVersion !== PRIVACY_VERSION
      ) {
        return errorResponse(req, "MUST_ACCEPT_LEGAL", 400);
      }

      // Check user doesn't already exist
      const { $users } = await adminDb.query({
        $users: { $: { where: { email: normalizedEmail } } },
      });
      if ($users.length > 0) {
        return errorResponse(req, "ACCOUNT_EXISTS", 409);
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create InstantDB auth token (also creates the $users record)
      const token = await adminDb.auth.createToken({ email: normalizedEmail });

      // Query to get the newly created user ID
      const { $users: newUsers } = await adminDb.query({
        $users: { $: { where: { email: normalizedEmail } } },
      });

      if (newUsers.length > 0) {
        const userId = newUsers[0].id;
        const userType = normalizedEmail === SUPER_ADMIN_EMAIL ? "superadmin" : "organizer";
        const now = Date.now();

        await adminDb.transact([
          adminDb.tx.$users[userId].update({
            type: userType,
            acceptedTermsVersion: TERMS_VERSION,
            acceptedTermsAt: now,
            acceptedOrganizerTermsVersion: ORGANIZER_TERMS_VERSION,
            acceptedOrganizerTermsAt: now,
            acceptedPrivacyVersion: PRIVACY_VERSION,
            acceptedPrivacyAt: now,
          }),
          adminDb.tx.credentials[id()]
            .update({ passwordHash, createdAt: Date.now() })
            .link({ user: userId }),
        ]);
      }

      return NextResponse.json({ token });
    }

    // ── Login ──
    const { $users } = await adminDb.query({
      $users: {
        $: { where: { email: normalizedEmail } },
        credentials: {},
      },
    });

    if ($users.length === 0) {
      return errorResponse(req, "NO_ACCOUNT", 404);
    }

    const user = $users[0];
    const creds = (user as unknown as { credentials: { passwordHash: string }[] }).credentials;
    const credential = Array.isArray(creds) ? creds[0] : creds;

    if (!credential?.passwordHash) {
      return errorResponse(req, "NO_PASSWORD_SET", 400);
    }

    const isValid = await verifyPassword(password, credential.passwordHash);
    if (!isValid) {
      return errorResponse(req, "INCORRECT_PASSWORD", 401);
    }

    const token = await adminDb.auth.createToken({ email: normalizedEmail });

    // Ensure user type is set
    if (!user.type) {
      const userType = normalizedEmail === SUPER_ADMIN_EMAIL ? "superadmin" : "organizer";
      await adminDb.transact(
        adminDb.tx.$users[user.id].update({ type: userType }),
      );
    }

    return NextResponse.json({ token });
  } catch (err) {
    console.error("[admin-auth] Auth error:", err);
    return errorResponse(req, "AUTH_FAILED", 500);
  }
}
