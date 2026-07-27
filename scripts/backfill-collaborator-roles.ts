import "dotenv/config";
import { adminDb } from "../src/lib/adminDb";

/**
 * Backfill collaborator roles + manager links.
 *
 * Existing collaborators had full owner-equivalent access, so they must all
 * become "co_organizer" AND be linked into the event's `managers` relation
 * (which the new instant.perms.ts uses to gate configuration writes). Without
 * this, legacy collaborators would silently lose config access after the perms
 * are pushed.
 *
 * Idempotent: only touches rows that are missing the role or the manager link.
 * Run AFTER `push schema` and BEFORE `push perms`:
 *   npx tsx scripts/backfill-collaborator-roles.ts
 */

function toId(rel: unknown): string | undefined {
  const r = Array.isArray(rel) ? rel[0] : rel;
  return (r as { id?: string } | undefined)?.id;
}

async function backfill() {
  console.log("Backfilling concert collaborators…");
  const { eventCollaborators } = await adminDb.query({
    eventCollaborators: { concert: {}, managerConcert: {} },
  });

  const concertTxns = [];
  for (const c of eventCollaborators as Array<{
    id: string;
    role?: string;
    concert?: unknown;
    managerConcert?: unknown;
  }>) {
    const concertId = toId(c.concert);
    const alreadyManager = !!toId(c.managerConcert);
    const needsRole = c.role !== "co_organizer" && c.role !== "box_office";
    const needsLink = !alreadyManager && !!concertId;
    if (!needsRole && !needsLink) continue;
    let tx = adminDb.tx.eventCollaborators[c.id];
    if (needsRole) tx = tx.update({ role: "co_organizer" });
    if (needsLink) tx = tx.link({ managerConcert: concertId! });
    concertTxns.push(tx);
  }
  if (concertTxns.length) {
    await adminDb.transact(concertTxns);
  }
  console.log(`  Updated ${concertTxns.length} eventCollaborators`);

  console.log("Backfilling guest-list collaborators…");
  const { guestListCollaborators } = await adminDb.query({
    guestListCollaborators: { event: {}, managerEvent: {} },
  });

  const glTxns = [];
  for (const c of guestListCollaborators as Array<{
    id: string;
    role?: string;
    event?: unknown;
    managerEvent?: unknown;
  }>) {
    const eventId = toId(c.event);
    const alreadyManager = !!toId(c.managerEvent);
    const needsRole = c.role !== "co_organizer" && c.role !== "box_office";
    const needsLink = !alreadyManager && !!eventId;
    if (!needsRole && !needsLink) continue;
    let tx = adminDb.tx.guestListCollaborators[c.id];
    if (needsRole) tx = tx.update({ role: "co_organizer" });
    if (needsLink) tx = tx.link({ managerEvent: eventId! });
    glTxns.push(tx);
  }
  if (glTxns.length) {
    await adminDb.transact(glTxns);
  }
  console.log(`  Updated ${glTxns.length} guestListCollaborators`);

  console.log("Done.");
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
