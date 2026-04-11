import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/password";

/** POST /api/admin-auth — check if email exists (login vs register) */
export async function POST(req: NextRequest) {
  try {
    const { email, action } = await req.json();

    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const mode = action === "register" ? "register" : "login";

    const { $users } = await adminDb.query({
      $users: { $: { where: { email: normalizedEmail } } },
    });
    const userExists = $users.length > 0;

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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin-auth] Check error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/** PUT /api/admin-auth — register or login with password */
export async function PUT(req: NextRequest) {
  try {
    const { email, password, confirmPassword, action } = await req.json();

    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    if (typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // ── Registration ──
    if (action === "register") {
      const passwordError = validatePassword(password);
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
      if (password !== confirmPassword) {
        return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
      }

      // Check user doesn't already exist
      const { $users } = await adminDb.query({
        $users: { $: { where: { email: normalizedEmail } } },
      });
      if ($users.length > 0) {
        return NextResponse.json(
          { error: "An account with this email already exists." },
          { status: 409 },
        );
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

        await adminDb.transact([
          adminDb.tx.$users[userId].update({ type: userType }),
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
      return NextResponse.json(
        { error: "No account found. Please create an account first." },
        { status: 404 },
      );
    }

    const user = $users[0];
    const creds = (user as unknown as { credentials: { passwordHash: string }[] }).credentials;
    const credential = Array.isArray(creds) ? creds[0] : creds;

    if (!credential?.passwordHash) {
      return NextResponse.json(
        { error: "No password set. Use 'Forgot password?' to set one." },
        { status: 400 },
      );
    }

    const isValid = await verifyPassword(password, credential.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
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
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
