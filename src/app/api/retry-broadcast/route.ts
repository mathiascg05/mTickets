import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import {
  resolveRecipients,
  type BroadcastFilters,
} from "@/lib/broadcastRecipients";
import {
  processBroadcastBatch,
  requeueFailedDeliveries,
} from "@/lib/broadcastProcessor";

// Vercel Hobby caps function duration at 60s.
export const maxDuration = 60;

type RetryMode = "failed" | "all" | "missing";

const INLINE_DRAIN_LIMIT = 80;
const INLINE_DRAIN_DEADLINE_MS = 35_000;

function parseFilters(raw: unknown): BroadcastFilters {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const f = parsed as Partial<BroadcastFilters>;
    return {
      ticketTypeIds: Array.isArray(f.ticketTypeIds) ? f.ticketTypeIds : [],
      paymentMethodTypes: Array.isArray(f.paymentMethodTypes)
        ? f.paymentMethodTypes
        : [],
      orderStatuses: Array.isArray(f.orderStatuses) ? f.orderStatuses : [],
    };
  } catch {
    return {};
  }
}

function parseLegacyFailed(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (typeof raw !== "string") return out;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return out;
    for (const entry of parsed) {
      const email = (entry as { email?: string })?.email;
      if (typeof email === "string") out.add(email.trim().toLowerCase());
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * Legacy migration: a broadcast created before per-recipient tracking has
 * counters + a failedEmailsJson blob, but no `broadcastDeliveries` rows. Before
 * we can retry, materialise one row per resolved recipient. Best-effort: if
 * the original orders are gone we still create rows for the failed emails
 * (without snapshot context) so the retry can proceed.
 */
async function materialiseLegacyDeliveries(
  broadcast: {
    id: string;
    filtersJson?: string;
    failedEmailsJson?: string;
  },
  concertId: string,
): Promise<{ created: number }> {
  const filters = parseFilters(broadcast.filtersJson);
  const failedSet = parseLegacyFailed(broadcast.failedEmailsJson);

  const hasFilters =
    (filters.ticketTypeIds?.length ?? 0) > 0 ||
    (filters.paymentMethodTypes?.length ?? 0) > 0 ||
    (filters.orderStatuses?.length ?? 0) > 0;
  if (!hasFilters && failedSet.size === 0) return { created: 0 };

  const resolved = hasFilters
    ? await resolveRecipients(concertId, filters)
    : { recipients: [], suppressedEmails: [] };

  const seen = new Set<string>();
  const rows: Array<{ data: Record<string, unknown> }> = [];
  const now = Date.now();

  for (const r of resolved.recipients) {
    const key = r.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const wasFailed = failedSet.has(key);
    rows.push({
      data: {
        email: key,
        emailDisplay: r.email,
        firstName: r.firstName ?? "",
        lastName: r.lastName ?? "",
        ticketTypeName: r.ticketTypeName ?? "",
        paymentMethod: r.paymentMethod ?? "",
        orderStatus: r.status ?? "",
        language: r.language,
        deliveryStatus: wasFailed ? "pending" : "sent",
        attempts: wasFailed ? 0 : 1,
        sentAt: wasFailed ? undefined : now,
        createdAt: now,
      },
    });
  }
  for (const email of resolved.suppressedEmails) {
    const key = email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      data: {
        email: key,
        emailDisplay: email,
        firstName: "",
        lastName: "",
        ticketTypeName: "",
        paymentMethod: "",
        orderStatus: "",
        deliveryStatus: "suppressed",
        attempts: 0,
        createdAt: now,
      },
    });
  }
  // Make sure every previously-failed email has a row even if the order is
  // gone (e.g. cancelled / hard-deleted between original send and retry).
  for (const email of failedSet) {
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({
      data: {
        email,
        emailDisplay: email,
        firstName: "",
        lastName: "",
        ticketTypeName: "",
        paymentMethod: "",
        orderStatus: "",
        deliveryStatus: "pending",
        attempts: 0,
        createdAt: now,
      },
    });
  }

  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    await adminDb.transact(
      slice.map((row) =>
        adminDb.tx.broadcastDeliveries[id()]
          .update(row.data)
          .link({ broadcast: broadcast.id }),
      ),
    );
  }
  return { created: rows.length };
}

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

    const { broadcastId, mode: rawMode } = (await req.json()) as {
      broadcastId: string;
      mode?: RetryMode;
    };
    if (!isValidUUID(broadcastId)) {
      return NextResponse.json({ error: "Invalid broadcast ID." }, { status: 400 });
    }
    const mode: RetryMode =
      rawMode === "all" || rawMode === "missing" ? rawMode : "failed";

    // Load broadcast + linked concert
    const { broadcasts } = await adminDb.query({
      broadcasts: {
        $: { where: { id: broadcastId } },
        concert: {
          collaborators: {},
        },
      },
    });
    const broadcast = broadcasts[0];
    if (!broadcast) {
      return NextResponse.json({ error: "Broadcast not found." }, { status: 404 });
    }

    const concert = Array.isArray(broadcast.concert)
      ? broadcast.concert[0]
      : broadcast.concert;
    if (!concert) {
      return NextResponse.json({ error: "Concert link missing." }, { status: 500 });
    }
    if (
      !isAuthorizedForConcert(user.email, {
        organizerEmail: concert.organizerEmail,
        collaborators: (concert as { collaborators?: { email: string }[] }).collaborators,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Lazy migration for legacy broadcasts (created before per-recipient
    // tracking). Materialise delivery rows from the saved filters +
    // failedEmailsJson so the new processor can take over. After migration the
    // previously-failed emails are already in the "pending" bucket, so for
    // "failed" mode we don't need to call requeueFailedDeliveries — we just
    // count what's pending and rely on the cron to pick it up.
    const { broadcastDeliveries: existingDeliveries = [] } = await adminDb.query({
      broadcastDeliveries: {
        $: { where: { "broadcast.id": broadcastId }, limit: 1 },
      },
    });
    let migratedFromLegacy = false;
    if (existingDeliveries.length === 0) {
      const result = await materialiseLegacyDeliveries(
        {
          id: broadcastId,
          filtersJson: broadcast.filtersJson as string | undefined,
          failedEmailsJson: broadcast.failedEmailsJson as string | undefined,
        },
        concert.id,
      );
      migratedFromLegacy = result.created > 0;
    }

    // Branch on mode.
    let requeued = 0;
    let suppressed = 0;
    let added = 0;

    if (mode === "missing") {
      // Re-resolve recipients via stored filters and create delivery rows for
      // any emails that don't already have one on this broadcast.
      const filters = parseFilters(broadcast.filtersJson);
      const hasAnyFilter =
        (filters.ticketTypeIds?.length ?? 0) > 0 ||
        (filters.paymentMethodTypes?.length ?? 0) > 0 ||
        (filters.orderStatuses?.length ?? 0) > 0;
      if (!hasAnyFilter) {
        return NextResponse.json(
          { error: "Original filters are missing or empty, cannot resend." },
          { status: 400 },
        );
      }
      const resolved = await resolveRecipients(concert.id, filters);

      // Pull existing delivery emails for this broadcast.
      const { broadcastDeliveries: existing = [] } = await adminDb.query({
        broadcastDeliveries: {
          $: { where: { "broadcast.id": broadcastId } },
        },
      });
      const existingEmails = new Set(
        existing
          .map((d) => (d as { email?: string }).email ?? "")
          .filter(Boolean)
          .map((e) => e.toLowerCase()),
      );

      const now = Date.now();
      const newRows = [
        ...resolved.recipients.map((r) => ({
          email: r.email,
          isSuppressed: false,
          recipient: r,
        })),
        ...resolved.suppressedEmails.map((email) => ({
          email,
          isSuppressed: true,
          recipient: null,
        })),
      ].filter((row) => !existingEmails.has(row.email.toLowerCase()));

      for (let i = 0; i < newRows.length; i += 100) {
        const slice = newRows.slice(i, i + 100);
        await adminDb.transact(
          slice.map((row) =>
            adminDb.tx.broadcastDeliveries[id()]
              .update({
                email: row.email.trim().toLowerCase(),
                emailDisplay: row.email,
                firstName: row.recipient?.firstName ?? "",
                lastName: row.recipient?.lastName ?? "",
                ticketTypeName: row.recipient?.ticketTypeName ?? "",
                paymentMethod: row.recipient?.paymentMethod ?? "",
                orderStatus: row.recipient?.status ?? "",
                language: row.recipient?.language,
                deliveryStatus: row.isSuppressed ? "suppressed" : "pending",
                attempts: 0,
                createdAt: now,
              })
              .link({ broadcast: broadcastId }),
          ),
        );
      }
      added = newRows.length;
      requeued = newRows.filter((r) => !r.isSuppressed).length;

      // Also bump recipientCount to include the new pendings.
      const newPending = newRows.filter((r) => !r.isSuppressed).length;
      const newSuppressed = newRows.filter((r) => r.isSuppressed).length;
      if (newPending > 0 || newSuppressed > 0) {
        await adminDb.transact(
          adminDb.tx.broadcasts[broadcastId].update({
            recipientCount: (broadcast.recipientCount ?? 0) + newPending,
            suppressedCount: (broadcast.suppressedCount ?? 0) + newSuppressed,
          }),
        );
      }
    } else {
      // mode: "failed" or "all"
      const result = await requeueFailedDeliveries(broadcastId, {
        includeSent: mode === "all",
      });
      requeued = result.requeued;
      suppressed = result.suppressed;

      // For freshly-migrated legacy broadcasts the previously-failed emails
      // are already in the "pending" bucket (the migration created them that
      // way), so requeueFailedDeliveries returns 0 even though there's real
      // work to do. Count those pending rows so the response and inline drain
      // both reflect the true workload.
      if (migratedFromLegacy && requeued === 0) {
        const { broadcastDeliveries: pendings = [] } = await adminDb.query({
          broadcastDeliveries: {
            $: {
              where: { "broadcast.id": broadcastId, deliveryStatus: "pending" },
            },
          },
        });
        requeued = pendings.length;
      }

      if (requeued === 0 && suppressed === 0 && added === 0) {
        return NextResponse.json(
          {
            error:
              "Nothing to retry — every targeted address is already sent or suppressed.",
          },
          { status: 400 },
        );
      }
    }

    // Mark broadcast as queued so the cron picks it up.
    if (requeued > 0 || added > 0) {
      await adminDb.transact(
        adminDb.tx.broadcasts[broadcastId].update({
          processingState: "queued",
          status: "sending",
        }),
      );
    }

    // Best-effort inline drain so the user sees immediate progress.
    let inlineResult = {
      claimed: 0,
      sent: 0,
      failed: 0,
      retryable: 0,
      drained: true,
    };
    if (requeued > 0 || added > 0) {
      try {
        inlineResult = await processBroadcastBatch(broadcastId, {
          limit: INLINE_DRAIN_LIMIT,
          deadlineMs: Date.now() + INLINE_DRAIN_DEADLINE_MS,
        });
      } catch (err) {
        console.error("[retry-broadcast] Inline drain error (cron will retry):", err);
      }
    }

    return NextResponse.json({
      success: true,
      mode,
      requeued,
      suppressed,
      added,
      inline: inlineResult,
    });
  } catch (err) {
    console.error("[retry-broadcast] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
