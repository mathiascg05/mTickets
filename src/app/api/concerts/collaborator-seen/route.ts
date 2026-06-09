import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";

export const maxDuration = 30;

// Only re-stamp if the last access is missing or older than this, so a
// collaborator reloading the page repeatedly doesn't write on every load.
const THROTTLE_MS = 60 * 60 * 1000; // 1h

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
    const concertId: string = body.concertId;
    if (!concertId || typeof concertId !== "string") {
      return NextResponse.json({ error: "concertId required" }, { status: 400 });
    }

    const { eventCollaborators } = await adminDb.query({
      eventCollaborators: {
        $: {
          where: {
            "concert.id": concertId,
            email: user.email.toLowerCase(),
          },
          limit: 1,
        },
      },
    });
    const collaborator = eventCollaborators[0] as
      | { id: string; lastAccessedAt?: number }
      | undefined;
    if (!collaborator) {
      // Organizer / super admin / non-collaborator: nothing to track.
      return NextResponse.json({ ok: true, tracked: false });
    }

    const now = Date.now();
    if (
      !collaborator.lastAccessedAt ||
      now - collaborator.lastAccessedAt > THROTTLE_MS
    ) {
      await adminDb.transact([
        adminDb.tx.eventCollaborators[collaborator.id].update({
          lastAccessedAt: now,
        }),
      ]);
    }

    return NextResponse.json({ ok: true, tracked: true });
  } catch (err) {
    console.error("[concerts/collaborator-seen] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
