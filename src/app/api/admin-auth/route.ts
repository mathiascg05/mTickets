import { NextRequest, NextResponse } from "next/server";
import { transporter, generateMessageId } from "@/lib/mailer";
import { adminDb } from "@/lib/adminDb";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";

const CODE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory store for pending codes (single-server is fine here)
const pendingCodes = new Map<string, { code: string; expiresAt: number }>();

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** POST /api/admin-auth — send a login code to the admin email */
export async function POST(req: NextRequest) {
  try {
    const { email, action } = await req.json();

    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── Send code ──
    const code = generateCode();
    pendingCodes.set(normalizedEmail, {
      code,
      expiresAt: Date.now() + CODE_TTL,
    });

    await transporter.sendMail({
      from: `"maTickets" <${process.env.GMAIL_USER}>`,
      to: normalizedEmail,
      subject: "Your admin login code",
      messageId: generateMessageId(),
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1e293b;">maTickets Admin Login</h2>
          <p>Your verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 16px; background: #f1f5f9; border-radius: 8px; text-align: center;">
            ${code}
          </div>
          <p style="color: #64748b; font-size: 14px; margin-top: 16px;">
            This code expires in 5 minutes.
          </p>
        </div>
      `,
    });

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[admin-auth] Send error:", err);
    return NextResponse.json(
      { error: "Failed to send code" },
      { status: 500 },
    );
  }
}

/** PUT /api/admin-auth — verify code and return InstantDB auth token */
export async function PUT(req: NextRequest) {
  try {
    const { email, code } = await req.json();

    if (typeof email !== "string" || typeof code !== "string") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = pendingCodes.get(normalizedEmail);

    if (!pending || pending.code !== code.trim() || pending.expiresAt < Date.now()) {
      return NextResponse.json(
        { error: "Code expired or invalid" },
        { status: 401 },
      );
    }

    // Code is valid — consume it
    pendingCodes.delete(normalizedEmail);

    // Create InstantDB auth token
    const token = await adminDb.auth.createToken({
      email: normalizedEmail,
    });

    // Ensure user has a role type set
    try {
      const { $users } = await adminDb.query({
        $users: { $: { where: { email: normalizedEmail } } },
      });
      if ($users.length > 0 && !$users[0].type) {
        const userType =
          normalizedEmail === SUPER_ADMIN_EMAIL ? "superadmin" : "organizer";
        await adminDb.transact(
          adminDb.tx.$users[$users[0].id].update({ type: userType }),
        );
      }
    } catch (e) {
      console.error("[admin-auth] Failed to set user type:", e);
    }

    return NextResponse.json({ token });
  } catch (err) {
    console.error("[admin-auth] Verify error:", err);
    return NextResponse.json(
      { error: "Verification failed" },
      { status: 500 },
    );
  }
}
