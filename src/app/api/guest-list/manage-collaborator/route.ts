import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import {
  isPrimaryOrganizer,
  normalizeCollaboratorRole,
  COLLABORATOR_ROLES,
  type CollaboratorRole,
} from "@/lib/authHelpers";
import { assertOrganizerCanAccessGuestListEvent } from "@/lib/guestListAuth";
import { recordAuditLog } from "@/lib/auditLog";

export const maxDuration = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Guest-list counterpart of concerts/manage-collaborator. Owner-only. The only
 * path that maintains the `managers` link for guest-list events.
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
    const eventId: string = body.eventId;
    const action: string = body.action;
    const role: CollaboratorRole = normalizeCollaboratorRole(body.role);

    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }
    if (!COLLABORATOR_ROLES.includes(role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    const auth = await assertOrganizerCanAccessGuestListEvent(
      user.email,
      eventId,
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const event = auth.data;

    if (!isPrimaryOrganizer(user.email, event.organizerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "create") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "invalid email" }, { status: 400 });
      }
      if (email === event.organizerEmail.toLowerCase()) {
        return NextResponse.json({ error: "is organizer" }, { status: 400 });
      }
      const already = (event.collaborators ?? []).some(
        (c) => c.email.toLowerCase() === email,
      );
      if (already) {
        return NextResponse.json({ error: "already invited" }, { status: 409 });
      }

      const newId = id();
      const link: Record<string, string> = { event: eventId };
      if (role === "co_organizer") link.managerEvent = eventId;
      await adminDb.transact([
        adminDb.tx.guestListCollaborators[newId]
          .update({
            email,
            role,
            invitedAt: Date.now(),
            invitedByEmail: user.email,
          })
          .link(link),
      ]);

      await recordAuditLog({
        action: "collab.added",
        actorEmail: user.email,
        entityType: "guestListEvent",
        entityId: eventId,
        guestListEventId: eventId,
        summary: `Agregó colaborador ${email} (${role}) en ${event.name}`,
        metadata: { collaboratorEmail: email, role },
      });

      return NextResponse.json({ collaboratorId: newId, role });
    }

    if (action === "setRole") {
      const collaboratorId: string = body.collaboratorId;
      if (!collaboratorId || typeof collaboratorId !== "string") {
        return NextResponse.json(
          { error: "collaboratorId required" },
          { status: 400 },
        );
      }
      const { guestListCollaborators } = await adminDb.query({
        guestListCollaborators: {
          $: { where: { id: collaboratorId } },
          event: {},
        },
      });
      const collaborator = guestListCollaborators[0] as
        | { id: string; email?: string; event?: unknown }
        | undefined;
      const rawEvent = collaborator?.event as unknown;
      const linkedEvent = (
        Array.isArray(rawEvent) ? rawEvent[0] : rawEvent
      ) as { id: string } | undefined;
      if (!collaborator || linkedEvent?.id !== eventId) {
        return NextResponse.json(
          { error: "Collaborator not found" },
          { status: 404 },
        );
      }

      const tx = adminDb.tx.guestListCollaborators[collaboratorId].update({
        role,
      });
      const linked =
        role === "co_organizer"
          ? tx.link({ managerEvent: eventId })
          : tx.unlink({ managerEvent: eventId });
      await adminDb.transact([linked]);

      await recordAuditLog({
        action: "collab.role.changed",
        actorEmail: user.email,
        entityType: "guestListEvent",
        entityId: eventId,
        guestListEventId: eventId,
        summary: `Cambió rol de ${collaborator.email} a ${role} en ${event.name}`,
        metadata: { collaboratorEmail: collaborator.email, role },
      });

      return NextResponse.json({ ok: true, role });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[guest-list/manage-collaborator] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
