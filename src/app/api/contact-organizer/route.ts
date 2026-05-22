import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID, isValidEmail, isValidName } from "@/lib/validation";
import { errorResponse } from "@/lib/serverI18n";
import { detectLocale, resolveEmailLang } from "@/lib/serverLocale";
import {
  isPendingAttachmentPath,
  shapeCheckAttachments,
  verifyAttachmentsExist,
  stringifyAttachments,
} from "@/lib/imageUpload";
import { generateInviteToken } from "@/lib/guestListTokens";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { buildMailHeaders } from "@/lib/emailHeaders";
import {
  buildThreadInviteEmailHtml,
  buildThreadInviteEmailText,
} from "@/lib/emailTemplate";
import { getTranslations } from "next-intl/server";

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 3;
const RATE_WINDOW_MS = 10 * 60_000;
const TOKEN_TTL_MS = 90 * 24 * 60 * 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(key, recent);
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      concertId,
      firstName,
      lastName,
      email,
      subject,
      body: messageBody,
      attachments: rawAttachments,
    } = body;

    if (!isValidUUID(concertId)) {
      return errorResponse(req, "INVALID_EVENT", 400);
    }
    if (!isValidName(firstName)) {
      return errorResponse(req, "INVALID_FIRST_NAME", 400);
    }
    if (!isValidName(lastName)) {
      return errorResponse(req, "INVALID_LAST_NAME", 400);
    }
    if (!isValidEmail(email)) {
      return errorResponse(req, "INVALID_EMAIL", 400);
    }
    if (typeof subject !== "string" || subject.trim().length === 0 || subject.length > 200) {
      return errorResponse(req, "SUBJECT_REQUIRED", 400);
    }
    if (typeof messageBody !== "string" || messageBody.trim().length === 0 || messageBody.length > 2000) {
      return errorResponse(req, "MESSAGE_BODY_REQUIRED", 400);
    }

    const attachmentCheck = shapeCheckAttachments(rawAttachments, isPendingAttachmentPath);
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

    const normalizedEmail = (email as string).toLowerCase().trim();

    if (!checkRateLimit(normalizedEmail)) {
      return errorResponse(req, "TOO_MANY_MESSAGES", 429);
    }

    const { concerts } = await adminDb.query({
      concerts: { $: { where: { id: concertId } } },
    });
    const concertForContact = concerts[0];
    if (!concertForContact || concertForContact.status !== "active") {
      return errorResponse(req, "EVENT_NOT_AVAILABLE_CONTACT", 404);
    }

    if (attachments.length > 0) {
      const verify = await verifyAttachmentsExist(adminDb, attachments);
      if (!verify.ok) {
        return errorResponse(req, "ATTACHMENT_MISSING", 400);
      }
    }

    const lang = detectLocale(req);
    const emailLang = resolveEmailLang(
      lang,
      (concertForContact as { defaultLanguage?: string }).defaultLanguage,
    );
    const messageId = id();
    const accessToken = generateInviteToken();
    const now = Date.now();
    const tokenExpiresAt = now + TOKEN_TTL_MS;

    await adminDb.transact(
      adminDb.tx.messages[messageId]
        .create({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: normalizedEmail,
          subject: subject.trim(),
          body: messageBody.trim(),
          status: "new",
          language: lang,
          attachments: stringifyAttachments(attachments) ?? undefined,
          accessToken,
          tokenExpiresAt,
          lastActivityAt: now,
          createdAt: now,
        })
        .link({ concert: concertId }),
    );

    if (!(await isEmailSuppressed(normalizedEmail))) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matickets.net";
      const threadUrl = `${appUrl}/${emailLang}/messages/${accessToken}`;
      const eventName = (concertForContact as { name?: string }).name ?? "";
      const tSubj = await getTranslations({ locale: emailLang, namespace: "emails.threadInvite" });
      const emailParams = {
        firstName: firstName.trim(),
        eventName,
        subject: subject.trim(),
        threadUrl,
        lang: emailLang,
      };
      transporter
        .sendMail({
          from: `"maTickets" <${EMAIL_FROM}>`,
          to: normalizedEmail,
          subject: tSubj("subject", { eventName }),
          messageId: generateMessageId(),
          text: await buildThreadInviteEmailText(emailParams),
          html: await buildThreadInviteEmailHtml(emailParams),
          headers: buildMailHeaders(normalizedEmail),
        })
        .catch((err) => {
          console.error("[contact-organizer] thread-invite email failed:", err);
        });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[contact-organizer] error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
