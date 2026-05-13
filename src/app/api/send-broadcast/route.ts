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

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;
const RECIPIENT_LIMIT = 100;
const CHUNK_SIZE = 5;

async function sendOneEmail(
  recipient: BroadcastRecipient,
  params: {
    eventName: string;
    subject: string;
    body: string;
    organizerEmail: string;
    concertDefaultLanguage?: string;
  },
): Promise<boolean> {
  try {
    const lang = resolveEmailLang(recipient.language, params.concertDefaultLanguage);
    await transporter.sendMail({
      from: `"maTickets" <${EMAIL_FROM}>`,
      to: recipient.email,
      subject: params.subject,
      messageId: generateMessageId(),
      text: await buildBroadcastEmailText({
        firstName: recipient.firstName,
        eventName: params.eventName,
        subject: params.subject,
        body: params.body,
        organizerEmail: params.organizerEmail,
        lang,
      }),
      html: await buildBroadcastEmailHtml({
        firstName: recipient.firstName,
        eventName: params.eventName,
        subject: params.subject,
        body: params.body,
        organizerEmail: params.organizerEmail,
        lang,
      }),
      headers: buildMailHeaders(recipient.email),
    });
    return true;
  } catch (err) {
    console.error(`[send-broadcast] Failed to send to ${recipient.email}:`, err);
    return false;
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
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(chunk.map((r) => sendOneEmail(r, emailParams)));
      for (const ok of results) {
        if (ok) sentCount++;
        else failedCount++;
      }
    }

    const finalStatus = failedCount === recipients.length ? "failed" : "sent";

    await adminDb.transact(
      adminDb.tx.broadcasts[broadcastId].update({
        sentCount,
        failedCount,
        status: finalStatus,
        completedAt: Date.now(),
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
