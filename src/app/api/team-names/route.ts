import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessConcert } from "@/lib/authHelpers";
import { assertOrganizerCanAccessGuestListEvent } from "@/lib/guestListAuth";
import { fullName } from "@/lib/userNames";

export const maxDuration = 30;

/**
 * Resolves display names for the *team* of one event (primary organizer +
 * collaborators). The client cannot read other people's $users rows, so this
 * runs with adminDb.
 *
 * Body: { concertId } | { guestListEventId }
 * Returns: { names: { "<email>": "First Last" } } — only emails that already
 * appear on that event's team, and only the name (no phone, no id).
 */
export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const concertId: unknown = body.concertId;
    const guestListEventId: unknown = body.guestListEventId;

    const access =
      typeof concertId === "string" && concertId
        ? await assertOrganizerCanAccessConcert(user.email, concertId)
        : typeof guestListEventId === "string" && guestListEventId
          ? await assertOrganizerCanAccessGuestListEvent(
              user.email,
              guestListEventId,
            )
          : null;

    if (!access) {
      return NextResponse.json(
        { error: "concertId or guestListEventId required" },
        { status: 400 },
      );
    }
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const event = access.data;
    const emails = [
      ...new Set(
        [
          event.organizerEmail,
          ...(event.collaborators ?? []).map((c) => c.email),
        ]
          .filter(Boolean)
          .map((e) => e.toLowerCase()),
      ),
    ];
    if (emails.length === 0) {
      return NextResponse.json({ names: {} });
    }

    const { $users } = await adminDb.query({
      $users: { $: { where: { email: { $in: emails } } } },
    });

    const names: Record<string, string> = {};
    for (const u of $users) {
      if (!u.email) continue;
      const name = fullName(u);
      if (name) names[u.email.toLowerCase()] = name;
    }

    return NextResponse.json({ names });
  } catch (err) {
    console.error("[team-names] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
