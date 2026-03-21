import { NextRequest, NextResponse } from "next/server";
import { transporter, generateMessageId } from "@/lib/mailer";
import { adminDb } from "@/lib/adminDb";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";

const CODE_TTL = 5 * 60 * 1000; // 5 minutes
const SUPER_ADMIN_PASSWORD = "Mathias01";

// In-memory store for pending codes (single-server is fine here)
const pendingCodes = new Map<
  string,
  { code: string; expiresAt: number; action: "login" | "register" }
>();

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** POST /api/admin-auth — send a login or registration code */
export async function POST(req: NextRequest) {
  try {
    const { email, action } = await req.json();

    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const mode = action === "register" ? "register" : "login";

    // Check if user already exists
    const { $users } = await adminDb.query({
      $users: { $: { where: { email: normalizedEmail } } },
    });
    const userExists = $users.length > 0;

    // Super admin always uses password — skip account check
    if (normalizedEmail === SUPER_ADMIN_EMAIL) {
      return NextResponse.json({ sent: true, requiresPassword: true });
    }

    if (mode === "login" && !userExists) {
      return NextResponse.json(
        { error: "No account found. Please create an account first." },
        { status: 404 },
      );
    }

    if (mode === "register" && userExists) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please log in." },
        { status: 409 },
      );
    }

    // ── Send code ──
    const code = generateCode();
    pendingCodes.set(normalizedEmail, {
      code,
      expiresAt: Date.now() + CODE_TTL,
      action: mode,
    });

    const subject =
      mode === "register"
        ? "Your maTickets registration code"
        : "Your maTickets login code";

    const heading =
      mode === "register"
        ? "maTickets Account Registration"
        : "maTickets Admin Login";

    await transporter.sendMail({
      from: `"maTickets" <${process.env.GMAIL_USER}>`,
      to: normalizedEmail,
      subject,
      messageId: generateMessageId(),
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1e293b;">${heading}</h2>
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

    return NextResponse.json({ sent: true, requiresPassword: false });
  } catch (err) {
    console.error("[admin-auth] Send error:", err);
    return NextResponse.json(
      { error: "Failed to send code" },
      { status: 500 },
    );
  }
}

/** PUT /api/admin-auth — verify code/password and return InstantDB auth token */
export async function PUT(req: NextRequest) {
  try {
    const { email, code, password } = await req.json();

    if (typeof email !== "string") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let isRegistration = false;

    // Super admin uses password authentication
    if (normalizedEmail === SUPER_ADMIN_EMAIL) {
      if (typeof password !== "string" || password !== SUPER_ADMIN_PASSWORD) {
        return NextResponse.json(
          { error: "Incorrect password" },
          { status: 401 },
        );
      }
    } else {
      // Regular users use code verification
      if (typeof code !== "string") {
        return NextResponse.json({ error: "Invalid input" }, { status: 400 });
      }

      const pending = pendingCodes.get(normalizedEmail);

      if (!pending || pending.code !== code.trim() || pending.expiresAt < Date.now()) {
        return NextResponse.json(
          { error: "Code expired or invalid" },
          { status: 401 },
        );
      }

      isRegistration = pending.action === "register";

      // Code is valid — consume it
      pendingCodes.delete(normalizedEmail);
    }

    // Create InstantDB auth token
    const token = await adminDb.auth.createToken({
      email: normalizedEmail,
    });

    // Set user role type
    try {
      const { $users } = await adminDb.query({
        $users: { $: { where: { email: normalizedEmail } } },
      });
      if ($users.length > 0 && (!$users[0].type || isRegistration)) {
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
