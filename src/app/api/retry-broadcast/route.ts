import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { sendBatch } from "@/lib/broadcastSend";
import type { BroadcastRecipient } from "@/lib/broadcastRecipients";
import { isEmailSuppressed } from "@/lib/emailSuppression";

export const maxDuration = 300;

type FailedEntry = { email: string; reason?: string };

function parseFailed(raw: unknown): FailedEntry[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is FailedEntry => typeof e?.email === "string",
    );
  } catch {
    return [];
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

    const { broadcastId } = (await req.json()) as { broadcastId: string };
    if (!isValidUUID(broadcastId)) {
      return NextResponse.json({ error: "Invalid broadcast ID." }, { status: 400 });
    }

    // Load broadcast + linked concert (and concert collaborators for auth)
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

    const failed = parseFailed(broadcast.failedEmailsJson);
    if (failed.length === 0) {
      return NextResponse.json(
        { error: "Nothing to retry — this campaign has no failed deliveries." },
        { status: 400 },
      );
    }

    const emails = Array.from(new Set(failed.map((f) => f.email)));

    // Look up orders for these emails on the concert so we have firstName /
    // language for the personalized email. Fall back to bare info if no order
    // is found (covers manual additions or deleted orders).
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

    // Build recipient list, skipping suppressed addresses (bounce list etc.)
    const recipients: BroadcastRecipient[] = [];
    const skippedSuppressed: FailedEntry[] = [];
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

    if (recipients.length === 0) {
      // All previously failed addresses are now on the suppression list — just
      // update the record so the UI reflects reality.
      const stillFailed = skippedSuppressed;
      await adminDb.transact(
        adminDb.tx.broadcasts[broadcastId].update({
          failedCount: stillFailed.length,
          failedEmailsJson: JSON.stringify(stillFailed),
        }),
      );
      return NextResponse.json({
        success: true,
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
    const totalSentCount = (broadcast.sentCount ?? 0) + newSentCount;
    const totalFailedCount = stillFailed.length;
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
      }),
    );

    return NextResponse.json({
      success: true,
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
