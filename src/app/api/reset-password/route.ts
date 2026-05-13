import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { hashPassword, validatePassword } from "@/lib/password";
import { buildResetUrl, verifyResetToken } from "@/lib/resetToken";
import { errorResponse } from "@/lib/serverI18n";

/** POST /api/reset-password — send reset email */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (typeof email !== "string" || !email.includes("@")) {
      return errorResponse(req, "INVALID_EMAIL", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check user exists
    const { $users } = await adminDb.query({
      $users: { $: { where: { email: normalizedEmail } } },
    });

    // Always return success to prevent email enumeration
    if ($users.length === 0) {
      return NextResponse.json({ ok: true });
    }

    const resetUrl = buildResetUrl(normalizedEmail);

    await transporter.sendMail({
      from: `"maTickets" <${EMAIL_FROM}>`,
      to: normalizedEmail,
      subject: "Reset your maTickets password",
      messageId: generateMessageId(),
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a2b4a;">Reset your password</h2>
          <p style="color: #334155;">We received a request to reset the password for your maTickets account.</p>
          <p style="color: #334155;">Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 32px; background: #1a2b4a; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Reset Password
            </a>
          </div>
          <p style="color: #64748b; font-size: 14px;">This link expires in 30 minutes.</p>
          <p style="color: #64748b; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
      text: `Reset your maTickets password.\n\nClick here to set a new password: ${resetUrl}\n\nThis link expires in 30 minutes.\n\nIf you didn't request this, ignore this email.`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password] Send error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}

/** PUT /api/reset-password — verify token and set new password */
export async function PUT(req: NextRequest) {
  try {
    const { email, token, password, confirmPassword } = await req.json();

    if (typeof email !== "string" || typeof token !== "string") {
      return errorResponse(req, "INVALID_INPUT", 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!verifyResetToken(normalizedEmail, token)) {
      return errorResponse(req, "INVALID_RESET_LINK", 400);
    }

    if (typeof password !== "string") {
      return errorResponse(req, "PASSWORD_REQUIRED", 400);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return errorResponse(req, passwordError.code, 400, { values: passwordError.values });
    }

    if (password !== confirmPassword) {
      return errorResponse(req, "PASSWORDS_MISMATCH", 400);
    }

    // Find user and their credentials
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
    const creds = (user as unknown as { credentials: { id: string }[] }).credentials;
    const credential = Array.isArray(creds) ? creds[0] : creds;

    const newHash = await hashPassword(password);

    if (credential?.id) {
      // Update existing credentials
      await adminDb.transact(
        adminDb.tx.credentials[credential.id].update({ passwordHash: newHash }),
      );
    } else {
      // Create credentials if they don't exist (edge case: old user without password)
      const { id } = await import("@instantdb/admin");
      await adminDb.transact(
        adminDb.tx.credentials[id()]
          .update({ passwordHash: newHash, createdAt: Date.now() })
          .link({ user: user.id }),
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[reset-password] Reset error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
