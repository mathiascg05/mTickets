import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import {
  assertOrganizerCanAccessConcert,
  isPrimaryOrganizer,
  normalizeCollaboratorRole,
  COLLABORATOR_ROLES,
  type CollaboratorRole,
} from "@/lib/authHelpers";
import { recordAuditLog } from "@/lib/auditLog";

export const maxDuration = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Authoritative endpoint for collaborator roles. Only the primary organizer (or
 * super admin) may call it. It is the ONLY path that maintains the `managers`
 * link, so a lower-tier collaborator can never grant themselves config access.
 *
 * Body:
 *  - { concertId, action: "create", email, role }  -> creates a collaborator,
 *      links it to the event (+ managers link when role is co_organizer).
 *      Returns { collaboratorId } so the client can trigger the invite email.
 *  - { concertId, action: "setRole", collaboratorId, role } -> updates the role
 *      and adds/removes the managers link accordingly.
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
    const concertId: string = body.concertId;
    const action: string = body.action;
    const role: CollaboratorRole = normalizeCollaboratorRole(body.role);

    if (!concertId || typeof concertId !== "string") {
      return NextResponse.json({ error: "concertId required" }, { status: 400 });
    }
    if (!COLLABORATOR_ROLES.includes(role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    const auth = await assertOrganizerCanAccessConcert(user.email, concertId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const concert = auth.data;

    // Team management is owner-only (primary organizer or super admin).
    if (!isPrimaryOrganizer(user.email, concert.organizerEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "create") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: "invalid email" }, { status: 400 });
      }
      if (email === concert.organizerEmail.toLowerCase()) {
        return NextResponse.json({ error: "is organizer" }, { status: 400 });
      }
      const already = (concert.collaborators ?? []).some(
        (c) => c.email.toLowerCase() === email,
      );
      if (already) {
        return NextResponse.json(
          { error: "already invited" },
          { status: 409 },
        );
      }

      const newId = id();
      const link: Record<string, string> = { concert: concertId };
      if (role === "co_organizer") link.managerConcert = concertId;
      await adminDb.transact([
        adminDb.tx.eventCollaborators[newId]
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
        entityType: "concert",
        entityId: concertId,
        concertId,
        summary: `Agregó colaborador ${email} (${role}) en ${concert.name}`,
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
      // Confirm the collaborator belongs to this event.
      const { eventCollaborators } = await adminDb.query({
        eventCollaborators: {
          $: { where: { id: collaboratorId } },
          concert: {},
        },
      });
      const collaborator = eventCollaborators[0] as
        | { id: string; email?: string; concert?: unknown }
        | undefined;
      const rawConcert = collaborator?.concert as unknown;
      const linkedConcert = (
        Array.isArray(rawConcert) ? rawConcert[0] : rawConcert
      ) as { id: string } | undefined;
      if (!collaborator || linkedConcert?.id !== concertId) {
        return NextResponse.json(
          { error: "Collaborator not found" },
          { status: 404 },
        );
      }

      const tx = adminDb.tx.eventCollaborators[collaboratorId].update({ role });
      // Managers link mirrors the co_organizer role.
      const linked =
        role === "co_organizer"
          ? tx.link({ managerConcert: concertId })
          : tx.unlink({ managerConcert: concertId });
      await adminDb.transact([linked]);

      await recordAuditLog({
        action: "collab.role.changed",
        actorEmail: user.email,
        entityType: "concert",
        entityId: concertId,
        concertId,
        summary: `Cambió rol de ${collaborator.email} a ${role} en ${concert.name}`,
        metadata: { collaboratorEmail: collaborator.email, role },
      });

      return NextResponse.json({ ok: true, role });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[concerts/manage-collaborator] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
