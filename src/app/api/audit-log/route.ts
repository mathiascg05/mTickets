import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isSuperAdmin } from "@/lib/authHelpers";

const MAX_ROWS = 300;

/**
 * GET /api/audit-log
 *
 * Super-admin-only read of the immutable audit trail. The auditLogs entity is
 * locked (all perms false) so it is never exposed through the client SDK; this
 * route is the only way to read it. Optional filters: concertId,
 * guestListEventId, action, actorEmail.
 */
export async function GET(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isSuperAdmin(user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const where: Record<string, string> = {};
    const concertId = sp.get("concertId");
    const guestListEventId = sp.get("guestListEventId");
    const action = sp.get("action");
    const actorEmail = sp.get("actorEmail");
    if (concertId) where.concertId = concertId;
    if (guestListEventId) where.guestListEventId = guestListEventId;
    if (action) where.action = action;
    if (actorEmail) where.actorEmail = actorEmail.toLowerCase();

    const query = {
      auditLogs: {
        $: {
          ...(Object.keys(where).length > 0 ? { where } : {}),
          order: { createdAt: "desc" as const },
          limit: MAX_ROWS,
        },
      },
    } as Parameters<typeof adminDb.query>[0];

    const { auditLogs } = await adminDb.query(query);

    const rows = (auditLogs as Array<Record<string, unknown>>).map((r) => ({
      id: r.id,
      action: r.action,
      actorEmail: r.actorEmail,
      entityType: r.entityType,
      entityId: r.entityId,
      concertId: r.concertId ?? null,
      guestListEventId: r.guestListEventId ?? null,
      summary: r.summary,
      createdAt: r.createdAt,
      metadata: r.metadataJson
        ? (() => {
            try {
              return JSON.parse(r.metadataJson as string);
            } catch {
              return null;
            }
          })()
        : null,
    }));

    return NextResponse.json({ logs: rows });
  } catch (err) {
    console.error("[audit-log] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
