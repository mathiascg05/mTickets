import { id as genId } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";

type AuditInput = {
  /** Dotted action key, e.g. "order.approve", "overdraft.enable". */
  action: string;
  /** Verified email of the actor (from adminDb.auth.verifyToken). */
  actorEmail: string;
  /** Entity kind affected, e.g. "order", "guestListOrder", "platformFeeConfig". */
  entityType: string;
  /** Id of the affected entity (or a representative id for bulk actions). */
  entityId: string;
  concertId?: string;
  guestListEventId?: string;
  /** Human-readable one-liner shown in the audit view. */
  summary: string;
  /** Extra structured context (amounts, before/after, count, ...). */
  metadata?: Record<string, unknown>;
};

/**
 * Append an immutable audit record. Fire-and-forget: a logging failure must
 * never break the underlying action, so errors are swallowed (and logged to
 * the server console). The auditLogs entity is locked down in instant.perms.ts
 * (all rules false) so only the admin token can read or write it.
 */
export async function recordAuditLog(input: AuditInput): Promise<void> {
  try {
    await adminDb.transact([
      adminDb.tx.auditLogs[genId()].update({
        action: input.action,
        actorEmail: input.actorEmail.toLowerCase(),
        entityType: input.entityType,
        entityId: input.entityId,
        concertId: input.concertId,
        guestListEventId: input.guestListEventId,
        summary: input.summary,
        metadataJson: input.metadata
          ? JSON.stringify(input.metadata)
          : undefined,
        createdAt: Date.now(),
      }),
    ]);
  } catch (err) {
    console.error("[auditLog] Failed to record:", input.action, err);
  }
}
