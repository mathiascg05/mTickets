import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessGuestListEvent } from "@/lib/guestListAuth";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import {
  buildGuestInviteEmailHtml,
  buildGuestInviteEmailText,
} from "@/lib/guestListEmailTemplate";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { resolveEmailLang } from "@/lib/serverLocale";
import { formatEventDate } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";

const MAX_INLINE = 200;

type Mode = "all" | "pending";

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
    const eventId: string = body.eventId;
    const mode: Mode = body.mode === "all" ? "all" : "pending";
    if (!eventId || typeof eventId !== "string") {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }

    const auth = await assertOrganizerCanAccessGuestListEvent(user.email, eventId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const event = auth.data;

    const { guestListEntries } = await adminDb.query({
      guestListEntries: {
        $: { where: { "event.id": eventId, status: "invited" } },
      },
    });
    const entries = guestListEntries as {
      id: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      priceOverride?: number;
      inviteToken: string;
      inviteSentAt?: number;
    }[];

    const recipients = entries.filter((e) => {
      if (!e.email) return false;
      if (mode === "pending" && e.inviteSentAt) return false;
      return true;
    });

    if (recipients.length > MAX_INLINE) {
      return NextResponse.json(
        {
          error: `Too many recipients in single batch (${recipients.length}). Max ${MAX_INLINE} per call. Send in batches.`,
        },
        { status: 400 },
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const emailLang = resolveEmailLang(undefined, event.defaultLanguage);
    const tEmail = await getTranslations({
      locale: emailLang,
      namespace: "emails.guestInvite",
    });

    let sent = 0;
    let suppressed = 0;
    let failed = 0;
    const failedDetails: { email: string; reason: string }[] = [];

    for (const entry of recipients) {
      const email = entry.email!;
      try {
        if (await isEmailSuppressed(email)) {
          suppressed++;
          continue;
        }
        const inviteUrl = `${appUrl}/${emailLang}/invite/${entry.inviteToken}`;
        const finalPrice =
          typeof entry.priceOverride === "number"
            ? entry.priceOverride
            : event.defaultPrice;
        const priceLabel =
          finalPrice === 0 ? tEmail("freeLabel") : `$${finalPrice.toFixed(2)}`;

        const html = await buildGuestInviteEmailHtml({
          firstName: entry.firstName,
          eventName: event.name,
          eventDate: formatEventDate(event.date, emailLang),
          venue: event.venue || "",
          priceLabel,
          inviteUrl,
          organizerEmail: event.organizerEmail,
          primaryColor: event.primaryColor,
          lang: emailLang,
        });
        const text = await buildGuestInviteEmailText({
          firstName: entry.firstName,
          eventName: event.name,
          eventDate: formatEventDate(event.date, emailLang),
          venue: event.venue || "",
          priceLabel,
          inviteUrl,
          organizerEmail: event.organizerEmail,
          lang: emailLang,
        });

        await transporter.sendMail({
          from: `"maTickets" <${EMAIL_FROM}>`,
          replyTo: event.organizerEmail,
          to: email,
          subject: tEmail("subject", { eventName: event.name }),
          html,
          text,
          messageId: generateMessageId(),
          date: new Date(),
          envelope: { from: EMAIL_FROM, to: email },
          headers: buildMailHeaders(email),
        });

        await adminDb.transact([
          adminDb.tx.guestListEntries[entry.id].update({
            inviteSentAt: Date.now(),
          }),
        ]);
        sent++;
      } catch (err) {
        failed++;
        const reason = err instanceof Error ? err.message : String(err);
        failedDetails.push({ email, reason });
        console.warn(`[guest-list/send-invites] Failed for ${email}:`, reason);
      }

      // Throttle to ~2 req/s for Resend free tier
      await new Promise((r) => setTimeout(r, 600));
    }

    return NextResponse.json({
      sent,
      suppressed,
      failed,
      failedDetails: failedDetails.slice(0, 50),
    });
  } catch (err) {
    console.error("[guest-list/send-invites] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
