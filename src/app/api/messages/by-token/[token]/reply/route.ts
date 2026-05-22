import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";
import { errorResponse } from "@/lib/serverI18n";
import { resolveEmailLang } from "@/lib/serverLocale";
import {
  isCustomerReplyAttachmentPath,
  shapeCheckAttachments,
  verifyAttachmentsExist,
  stringifyAttachments,
} from "@/lib/imageUpload";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import {
  buildOrganizerNotifyEmailHtml,
  buildOrganizerNotifyEmailText,
} from "@/lib/emailTemplate";
import { getTranslations } from "next-intl/server";

const rateLimitByToken = new Map<string, number[]>();
const rateLimitByIp = new Map<string, number[]>();
const TOKEN_LIMIT = 5;
const IP_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60_000;
const TOKEN_TTL_MS = 90 * 24 * 60 * 60_000;

function checkLimit(map: Map<string, number[]>, key: string, limit: number): boolean {
  const now = Date.now();
  const recent = (map.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= limit) return false;
  recent.push(now);
  map.set(key, recent);
  return true;
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    if (!isValidToken(token)) {
      return errorResponse(req, "TOKEN_INVALID", 400);
    }

    if (!checkLimit(rateLimitByToken, token, TOKEN_LIMIT)) {
      return errorResponse(req, "RATE_LIMIT_EXCEEDED", 429);
    }
    if (!checkLimit(rateLimitByIp, getClientIp(req), IP_LIMIT)) {
      return errorResponse(req, "RATE_LIMIT_EXCEEDED", 429);
    }

    const { body: replyBody, attachments: rawAttachments } = await req.json();

    if (
      typeof replyBody !== "string" ||
      replyBody.trim().length === 0 ||
      replyBody.length > 5000
    ) {
      return errorResponse(req, "REPLY_BODY_REQUIRED", 400);
    }

    const { messages } = await adminDb.query({
      messages: {
        $: { where: { accessToken: token } },
        concert: { collaborators: {} },
      },
    });
    const message = messages[0] as
      | {
          id: string;
          firstName: string;
          lastName: string;
          subject: string;
          email: string;
          language?: string;
          accessToken?: string | null;
          tokenExpiresAt?: number;
          concert: unknown;
        }
      | undefined;
    if (!message) {
      return errorResponse(req, "TOKEN_INVALID", 404);
    }
    if (!message.accessToken) {
      return errorResponse(req, "TOKEN_REVOKED", 410);
    }
    if (message.tokenExpiresAt && message.tokenExpiresAt < Date.now()) {
      return errorResponse(req, "TOKEN_EXPIRED", 410);
    }

    const messageId = message.id;
    const attachmentCheck = shapeCheckAttachments(rawAttachments, (p) =>
      isCustomerReplyAttachmentPath(p, messageId),
    );
    if (!attachmentCheck.ok) {
      const code =
        attachmentCheck.reason === "TOO_MANY"
          ? "ATTACHMENT_TOO_MANY"
          : attachmentCheck.reason === "INVALID_MIME"
            ? "ATTACHMENT_INVALID_TYPE"
            : attachmentCheck.reason === "TOO_LARGE"
              ? "ATTACHMENT_TOO_LARGE"
              : attachmentCheck.reason === "BAD_PATH"
                ? "ATTACHMENT_BAD_PATH"
                : "INVALID_ATTACHMENTS";
      return errorResponse(req, code, 400);
    }
    const attachments = attachmentCheck.attachments;
    if (attachments.length > 0) {
      const verify = await verifyAttachmentsExist(adminDb, attachments);
      if (!verify.ok) {
        return errorResponse(req, "ATTACHMENT_MISSING", 400);
      }
    }

    const now = Date.now();
    const replyId = id();
    const attachmentsJson = stringifyAttachments(attachments);

    await adminDb.transact([
      adminDb.tx.messageReplies[replyId]
        .create({
          body: replyBody.trim(),
          sender: "customer",
          attachments: attachmentsJson ?? undefined,
          createdAt: now,
        })
        .link({ message: messageId }),
      adminDb.tx.messages[messageId].update({
        status: "customer-replied",
        lastActivityAt: now,
        tokenExpiresAt: now + TOKEN_TTL_MS,
      }),
    ]);

    // Notify organizer + collaborators.
    const rawConcert = message.concert as unknown;
    const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as
      | {
          name?: string;
          organizerEmail?: string;
          defaultLanguage?: string;
          collaborators?: Array<{ email?: string }>;
        }
      | undefined;
    const recipients = new Set<string>();
    if (concert?.organizerEmail) recipients.add(concert.organizerEmail);
    if (Array.isArray(concert?.collaborators)) {
      for (const c of concert.collaborators) {
        if (c?.email) recipients.add(c.email);
      }
    }

    if (recipients.size > 0) {
      const lang = resolveEmailLang(message.language, concert?.defaultLanguage);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matickets.net";
      const inboxUrl = `${appUrl}/${lang}/admin/communications?messageId=${messageId}`;
      const tSubj = await getTranslations({ locale: lang, namespace: "emails.organizerNotify" });
      const customerName = `${message.firstName} ${message.lastName}`.trim();
      const eventName = concert?.name ?? "";
      const emailParams = {
        eventName,
        customerName,
        subject: message.subject,
        inboxUrl,
        attachmentCount: attachments.length,
        lang,
      };
      const html = await buildOrganizerNotifyEmailHtml(emailParams);
      const text = await buildOrganizerNotifyEmailText(emailParams);
      const subj = tSubj("subject", { customerName, eventName });
      for (const to of recipients) {
        transporter
          .sendMail({
            from: `"maTickets" <${EMAIL_FROM}>`,
            to,
            subject: subj,
            messageId: generateMessageId(),
            text,
            html,
          })
          .catch((err) => {
            console.error(`[messages/by-token reply] organizer notify failed to=${to}`, err);
          });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[messages/by-token reply] error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
