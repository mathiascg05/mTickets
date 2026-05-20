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
import { autoRedeemFreeEntry } from "@/lib/guestListAutoRedeem";

export const maxDuration = 300;

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
    const event = auth.data as typeof auth.data & {
      orderNumberPrefix?: string;
      feeMode?: string;
    };

    const { guestListEntries } = await adminDb.query({
      guestListEntries: {
        $: { where: { "event.id": eventId, status: "invited" } },
        ticketType: {},
      },
    });
    const entries = guestListEntries as {
      id: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      cedula?: string;
      priceOverride?: number;
      inviteToken: string;
      inviteSentAt?: number;
      ticketType?: unknown;
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

    let invitesSent = 0;
    let ticketsSent = 0;
    let suppressed = 0;
    let failed = 0;
    const failedDetails: { email: string; reason: string }[] = [];

    for (const entry of recipients) {
      const email = entry.email!;
      try {
        const finalPrice =
          typeof entry.priceOverride === "number"
            ? entry.priceOverride
            : event.defaultPrice;

        if (finalPrice === 0) {
          const result = await autoRedeemFreeEntry(
            {
              id: entry.id,
              email: entry.email,
              firstName: entry.firstName,
              lastName: entry.lastName,
              cedula: entry.cedula,
              priceOverride: entry.priceOverride,
              ticketType: entry.ticketType,
            },
            {
              id: event.id,
              name: event.name,
              defaultPrice: event.defaultPrice,
              defaultLanguage: event.defaultLanguage,
              orderNumberPrefix: event.orderNumberPrefix,
              feeMode: event.feeMode,
            },
          );
          if ("success" in result) {
            ticketsSent++;
          } else if (result.error === "suppressed") {
            suppressed++;
          } else {
            failed++;
            failedDetails.push({ email, reason: result.error });
            console.warn(
              `[guest-list/send-invites] auto-redeem failed for ${email}:`,
              result.error,
            );
          }
        } else {
          if (await isEmailSuppressed(email)) {
            suppressed++;
            continue;
          }
          const inviteUrl = `${appUrl}/${emailLang}/invite/${entry.inviteToken}`;
          const priceLabel = `$${finalPrice.toFixed(2)}`;

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
          invitesSent++;
        }
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
      sent: invitesSent + ticketsSent,
      invitesSent,
      ticketsSent,
      suppressed,
      failed,
      failedDetails: failedDetails.slice(0, 50),
    });
  } catch (err) {
    console.error("[guest-list/send-invites] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
