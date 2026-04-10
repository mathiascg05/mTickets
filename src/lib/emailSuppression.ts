import { adminDb } from "@/lib/adminDb";
import { id } from "@instantdb/admin";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

export async function isEmailSuppressed(email: string): Promise<boolean> {
  const { emailSuppressions } = await adminDb.query({
    emailSuppressions: {
      $: { where: { email: normalize(email) }, limit: 1 },
    },
  });
  return emailSuppressions.length > 0;
}

export async function suppressEmail(
  email: string,
  reason: string,
  source: string,
  detail?: string,
): Promise<void> {
  const normalized = normalize(email);

  // Check if already suppressed
  const { emailSuppressions } = await adminDb.query({
    emailSuppressions: {
      $: { where: { email: normalized }, limit: 1 },
    },
  });

  if (emailSuppressions.length > 0) {
    console.log(`[email-suppression] Already suppressed: ${normalized}`);
    return;
  }

  try {
    await adminDb.transact(
      adminDb.tx.emailSuppressions[id()].update({
        email: normalized,
        reason,
        source,
        ...(detail ? { detail } : {}),
        createdAt: Date.now(),
      }),
    );
    console.log(`[email-suppression] Suppressed ${normalized} (${reason}/${source})`);
  } catch (err) {
    // Unique constraint violation = already suppressed (race condition)
    console.warn(`[email-suppression] Failed to suppress ${normalized}:`, err);
  }
}
