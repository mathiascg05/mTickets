import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { buildBroadcastEmailHtml, buildBroadcastEmailText } from "@/lib/emailTemplate";
import { buildMailHeaders } from "@/lib/emailHeaders";
import {
  resolveRecipients,
  type BroadcastFilters,
  type BroadcastRecipient,
} from "@/lib/broadcastRecipients";
import { resolveEmailLang } from "@/lib/serverLocale";

// Allow up to ~5 minutes; throttled sending of 100 recipients (the
// RECIPIENT_LIMIT) takes ~60-70s, comfortably under this ceiling on any plan
// that supports it (Vercel clamps to plan max automatically).
export const maxDuration = 300;

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;
const RECIPIENT_LIMIT = 100;
// Resend free is 2 req/s. Keep chunks small and pause between them so we
// never exceed the provider's rate limit (which used to surface as ~70%
// failure rate on bursts of 35+ recipients).
const CHUNK_SIZE = 2;
const CHUNK_DELAY_MS = 1100;
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = [2000, 4000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Resend returns 429 / "Too many requests"; nodemailer surfaces SMTP 421
  // ("Service not available") for throttled connections.
  return (
    msg.includes("429") ||
    msg.includes("too many") ||
    msg.includes("rate limit") ||
    msg.includes(" 421 ") ||
    msg.startsWith("421 ")
  );
}

type SendResult = { ok: true } | { ok: false; reason: string };

async function sendOneEmail(
  recipient: BroadcastRecipient,
  params: {
    eventName: string;
    subject: string;
    body: string;
    organizerEmail: string;
    concertDefaultLanguage?: string;
  },
): Promise<SendResult> {
  const lang = resolveEmailLang(recipient.language, params.concertDefaultLanguage);
  const [text, html] = await Promise.all([
    buildBroadcastEmailText({
      firstName: recipient.firstName,
      eventName: params.eventName,
      subject: params.subject,
      body: params.body,
      organizerEmail: params.organizerEmail,
      lang,
    }),
    buildBroadcastEmailHtml({
      firstName: recipient.firstName,
      eventName: params.eventName,
      subject: params.subject,
      body: params.body,
      organizerEmail: params.organizerEmail,
      lang,
    }),
  ]);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    try {
      await transporter.sendMail({
        from: `"maTickets" <${EMAIL_FROM}>`,
        to: recipient.email,
        subject: params.subject,
        messageId: generateMessageId(),
        text,
        html,
        headers: buildMailHeaders(recipient.email),
      });
      return { ok: true };
    } catch (err) {
      lastErr = err;
      if (attempt < RATE_LIMIT_RETRIES && isRateLimitError(err)) {
        await sleep(RATE_LIMIT_BACKOFF_MS[attempt] ?? 4000);
        continue;
      }
      break;
    }
  }

  console.error(`[send-broadcast] Failed to send to ${recipient.email}:`, lastErr);
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { ok: false, reason };
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

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "No recipients match the selected filters." },
        { status: 400 },
      );
    }
    if (recipients.length > RECIPIENT_LIMIT) {
      return NextResponse.json(
        {
          error: `Too many recipients (${recipients.length}). Maximum is ${RECIPIENT_LIMIT} per campaign. Narrow your filters.`,
        },
        { status: 400 },
      );
    }

    // Create broadcast record (status: "sending")
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
          createdByEmail: user.email,
          createdAt: now,
        })
        .link({ concert: concertId }),
    );

    // Send in chunks
    const emailParams = {
      eventName: concert.name,
      subject: subject.trim(),
      body: body.trim(),
      organizerEmail: concert.organizerEmail,
      concertDefaultLanguage: (concert as { defaultLanguage?: string }).defaultLanguage,
    };

    let sentCount = 0;
    let failedCount = 0;
    const failedEmails: { email: string; reason: string }[] = [];
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(chunk.map((r) => sendOneEmail(r, emailParams)));
      results.forEach((res, idx) => {
        if (res.ok) {
          sentCount++;
        } else {
          failedCount++;
          failedEmails.push({ email: chunk[idx].email, reason: res.reason });
        }
      });
      // Pause between chunks to respect Resend's 2 req/s rate limit. Skip the
      // wait after the final chunk so we don't pad the response unnecessarily.
      if (i + CHUNK_SIZE < recipients.length) {
        await sleep(CHUNK_DELAY_MS);
      }
    }

    const finalStatus = failedCount === recipients.length ? "failed" : "sent";

    await adminDb.transact(
      adminDb.tx.broadcasts[broadcastId].update({
        sentCount,
        failedCount,
        status: finalStatus,
        completedAt: Date.now(),
        ...(failedEmails.length > 0
          ? { failedEmailsJson: JSON.stringify(failedEmails) }
          : {}),
      }),
    );

    return NextResponse.json({
      success: true,
      broadcastId,
      sentCount,
      failedCount,
      suppressedCount: suppressedEmails.length,
      recipientCount: recipients.length,
    });
  } catch (err) {
    console.error("[send-broadcast] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
