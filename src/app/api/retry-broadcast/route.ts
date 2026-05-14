import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { sendBatch } from "@/lib/broadcastSend";
import {
  resolveRecipients,
  type BroadcastFilters,
  type BroadcastRecipient,
} from "@/lib/broadcastRecipients";
import { isEmailSuppressed } from "@/lib/emailSuppression";

export const maxDuration = 300;

type RetryMode = "failed" | "all";
type FailedEntry = { email: string; reason?: string };

function parseFailed(raw: unknown): FailedEntry[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is FailedEntry => typeof e?.email === "string");
  } catch {
    return [];
  }
}

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
    const mode: RetryMode = rawMode === "all" ? "all" : "failed";

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

    // Resolve the recipient list depending on mode.
    let recipients: BroadcastRecipient[] = [];
    let skippedSuppressed: FailedEntry[] = [];

    if (mode === "failed") {
      const failed = parseFailed(broadcast.failedEmailsJson);
      if (failed.length === 0) {
        return NextResponse.json(
          {
            error:
              "No per-recipient failure list saved for this campaign. Use mode \"all\" to resend to every original recipient.",
          },
          { status: 400 },
        );
      }
      const emails = Array.from(new Set(failed.map((f) => f.email)));

      // Look up orders for these emails to recover firstName / language.
      const { orders = [] } = await adminDb.query({
        orders: {
          $: {
            where: {
              "ticketType.concert.id": concert.id,
              email: { $in: emails },
            },
          },
        },
      });

      const byEmail = new Map<string, BroadcastRecipient>();
      for (const o of orders) {
        if (!o.email) continue;
        const key = o.email.trim().toLowerCase();
        if (byEmail.has(key)) continue;
        byEmail.set(key, {
          email: o.email,
          firstName: o.firstName ?? "",
          lastName: o.lastName ?? "",
          ticketTypeName: "",
          paymentMethod: o.paymentMethod ?? "",
          status: o.status ?? "",
          language: (o as { language?: string }).language,
        });
      }

      for (const email of emails) {
        if (await isEmailSuppressed(email)) {
          skippedSuppressed.push({ email, reason: "Suppressed (bounce list)" });
          continue;
        }
        const key = email.trim().toLowerCase();
        const r =
          byEmail.get(key) ??
          ({
            email,
            firstName: "",
            lastName: "",
            ticketTypeName: "",
            paymentMethod: "",
            status: "",
            language: undefined,
          } satisfies BroadcastRecipient);
        recipients.push(r);
      }
    } else {
      // mode === "all": re-resolve every original recipient via filtersJson.
      // This is the only option for legacy broadcasts that don't have a
      // per-recipient failure list saved. Note: people who already received
      // the email will receive it again — the caller should warn the user.
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
      recipients = resolved.recipients;
      skippedSuppressed = resolved.suppressedEmails.map((email) => ({
        email,
        reason: "Suppressed (bounce list)",
      }));
      if (recipients.length === 0) {
        return NextResponse.json(
          {
            error:
              "No recipients to resend — every original address is either gone from the orders table or on the suppression list.",
          },
          { status: 400 },
        );
      }
    }

    if (recipients.length === 0) {
      // Failed-mode edge case: all previously failed addresses are suppressed.
      const stillFailed = skippedSuppressed;
      await adminDb.transact(
        adminDb.tx.broadcasts[broadcastId].update({
          failedCount: stillFailed.length,
          failedEmailsJson: JSON.stringify(stillFailed),
        }),
      );
      return NextResponse.json({
        success: true,
        mode,
        retriedCount: 0,
        newSentCount: 0,
        newFailedCount: stillFailed.length,
        totalSentCount: broadcast.sentCount,
        totalFailedCount: stillFailed.length,
      });
    }

    const { sentCount: newSentCount, failedEmails: newlyFailed } = await sendBatch(
      recipients,
      {
        eventName: concert.name,
        subject: broadcast.subject,
        body: broadcast.body,
        organizerEmail: concert.organizerEmail,
        concertDefaultLanguage: (concert as { defaultLanguage?: string }).defaultLanguage,
      },
    );

    const stillFailed = [...newlyFailed, ...skippedSuppressed];

    // Counter strategy:
    // - mode="failed": sentCount accumulates (we know the original successes
    //   stayed successes, so we add only newSentCount).
    // - mode="all": legacy resend, we don't have a clean diff so the counters
    //   reflect the latest attempt. recipientCount also realigns to the
    //   resolved size in case filters now return a different audience.
    let totalSentCount: number;
    let totalFailedCount: number;
    let recipientCountUpdate: { recipientCount?: number };
    if (mode === "failed") {
      totalSentCount = (broadcast.sentCount ?? 0) + newSentCount;
      totalFailedCount = stillFailed.length;
      recipientCountUpdate = {};
    } else {
      totalSentCount = newSentCount;
      totalFailedCount = stillFailed.length;
      recipientCountUpdate = { recipientCount: recipients.length };
    }

    const finalStatus =
      totalFailedCount === 0
        ? "sent"
        : totalSentCount === 0
          ? "failed"
          : "sent";

    await adminDb.transact(
      adminDb.tx.broadcasts[broadcastId].update({
        sentCount: totalSentCount,
        failedCount: totalFailedCount,
        status: finalStatus,
        completedAt: Date.now(),
        failedEmailsJson: JSON.stringify(stillFailed),
        ...recipientCountUpdate,
      }),
    );

    return NextResponse.json({
      success: true,
      mode,
      retriedCount: recipients.length,
      newSentCount,
      newFailedCount: stillFailed.length,
      totalSentCount,
      totalFailedCount,
    });
  } catch (err) {
    console.error("[retry-broadcast] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
