import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import {
  resolveRecipients,
  type BroadcastFilters,
} from "@/lib/broadcastRecipients";
import { processBroadcastBatch } from "@/lib/broadcastProcessor";

// Vercel Hobby caps function duration at 60s. We split work between an inline
// drain (snappy UX for small campaigns) and the GitHub Actions cron pinger
// that calls /api/cron/process-broadcasts every minute.
export const maxDuration = 60;

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;
// Soft ceiling — protects from a runaway filter that resolves the entire
// orders table. There is no hard product cap on a campaign anymore; the cron
// worker handles whatever volume lands in the queue.
const MAX_RECIPIENTS = 5000;
// How many rows to drain inline. With Resend Pro tuning (CHUNK_SIZE=5 every
// 600ms ≈ 8 sends/sec), 80 rows fit in ~10s of send time, leaving plenty of
// headroom for row creation + counter recompute under the 60s Hobby cap.
const INLINE_DRAIN_LIMIT = 80;
const INLINE_DRAIN_DEADLINE_MS = 35_000;

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

    const { concertId, subject, body, filters } = (await req.json()) as {
      concertId: string;
      subject: string;
      body: string;
      filters: BroadcastFilters;
    };

    if (!isValidUUID(concertId)) {
      return NextResponse.json({ error: "Invalid concert ID." }, { status: 400 });
    }
    if (typeof subject !== "string" || subject.trim().length === 0 || subject.length > SUBJECT_MAX) {
      return NextResponse.json(
        { error: `Subject is required (max ${SUBJECT_MAX} chars).` },
        { status: 400 },
      );
    }
    if (typeof body !== "string" || body.trim().length === 0 || body.length > BODY_MAX) {
      return NextResponse.json(
        { error: `Body is required (max ${BODY_MAX} chars).` },
        { status: 400 },
      );
    }

    const safeFilters: BroadcastFilters = {
      ticketTypeIds: Array.isArray(filters?.ticketTypeIds) ? filters.ticketTypeIds : [],
      paymentMethodTypes: Array.isArray(filters?.paymentMethodTypes)
        ? filters.paymentMethodTypes
        : [],
      orderStatuses: Array.isArray(filters?.orderStatuses) ? filters.orderStatuses : [],
    };

    const hasAnyFilter =
      (safeFilters.ticketTypeIds?.length ?? 0) > 0 ||
      (safeFilters.paymentMethodTypes?.length ?? 0) > 0 ||
      (safeFilters.orderStatuses?.length ?? 0) > 0;
    if (!hasAnyFilter) {
      return NextResponse.json(
        { error: "Select at least one filter." },
        { status: 400 },
      );
    }

    // Authorize
    const { concerts } = await adminDb.query({
      concerts: {
        $: { where: { id: concertId } },
        collaborators: {},
      },
    });
    const concert = concerts[0];
    if (!concert) {
      return NextResponse.json({ error: "Concert not found." }, { status: 404 });
    }
    if (
      !isAuthorizedForConcert(user.email, {
        organizerEmail: concert.organizerEmail,
        collaborators: concert.collaborators,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { recipients, suppressedEmails } = await resolveRecipients(concertId, safeFilters);

    if (recipients.length === 0 && suppressedEmails.length === 0) {
      return NextResponse.json(
        { error: "No recipients match the selected filters." },
        { status: 400 },
      );
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        {
          error: `Too many recipients (${recipients.length}). Maximum is ${MAX_RECIPIENTS} per campaign. Narrow your filters.`,
        },
        { status: 400 },
      );
    }

    // 1. Create broadcast record (status: "sending", processingState: "queued").
    const broadcastId = id();
    const now = Date.now();
    await adminDb.transact(
      adminDb.tx.broadcasts[broadcastId]
        .update({
          subject: subject.trim(),
          body: body.trim(),
          filtersJson: JSON.stringify(safeFilters),
          recipientCount: recipients.length,
          sentCount: 0,
          failedCount: 0,
          suppressedCount: suppressedEmails.length,
          status: "sending",
          processingState: "queued",
          createdByEmail: user.email,
          createdAt: now,
        })
        .link({ concert: concertId }),
    );

    // 2. Create per-recipient delivery rows in batches of 100. Each row starts
    //    as "pending"; the cron worker (and the inline drain below) flips them
    //    to sent/failed/suppressed.
    const allRows: Array<{
      id: string;
      data: Record<string, unknown>;
      isSuppressed: boolean;
    }> = [];

    for (const r of recipients) {
      allRows.push({
        id: id(),
        data: {
          email: r.email.trim().toLowerCase(),
          emailDisplay: r.email,
          firstName: r.firstName ?? "",
          lastName: r.lastName ?? "",
          ticketTypeName: r.ticketTypeName ?? "",
          paymentMethod: r.paymentMethod ?? "",
          orderStatus: r.status ?? "",
          language: r.language,
          deliveryStatus: "pending",
          attempts: 0,
          createdAt: now,
        },
        isSuppressed: false,
      });
    }
    for (const email of suppressedEmails) {
      allRows.push({
        id: id(),
        data: {
          email: email.trim().toLowerCase(),
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
        isSuppressed: true,
      });
    }

    for (let i = 0; i < allRows.length; i += 100) {
      const slice = allRows.slice(i, i + 100);
      await adminDb.transact(
        slice.map((row) =>
          adminDb.tx.broadcastDeliveries[row.id]
            .update(row.data)
            .link({ broadcast: broadcastId }),
        ),
      );
    }

    // 3. Best-effort inline drain. For small campaigns this delivers the whole
    //    batch before the request returns; for large ones it gives the user
    //    immediate feedback and the cron picks up the tail.
    let inlineResult = {
      claimed: 0,
      sent: 0,
      failed: 0,
      retryable: 0,
      drained: false,
    };
    try {
      inlineResult = await processBroadcastBatch(broadcastId, {
        limit: INLINE_DRAIN_LIMIT,
        deadlineMs: Date.now() + INLINE_DRAIN_DEADLINE_MS,
      });
    } catch (err) {
      console.error("[send-broadcast] Inline drain error (cron will retry):", err);
    }

    return NextResponse.json({
      success: true,
      broadcastId,
      recipientCount: recipients.length,
      suppressedCount: suppressedEmails.length,
      inline: inlineResult,
    });
  } catch (err) {
    console.error("[send-broadcast] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
