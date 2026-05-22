import { NextRequest, NextResponse } from "next/server";
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { buildReplyEmailHtml, buildReplyEmailText } from "@/lib/emailTemplate";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { errorResponse } from "@/lib/serverI18n";
import { resolveEmailLang } from "@/lib/serverLocale";
import { getTranslations } from "next-intl/server";
import {
  isOrganizerReplyAttachmentPath,
  shapeCheckAttachments,
  verifyAttachmentsExist,
  stringifyAttachments,
} from "@/lib/imageUpload";
import { generateInviteToken } from "@/lib/guestListTokens";

const TOKEN_TTL_MS = 90 * 24 * 60 * 60_000;

export async function POST(req: NextRequest) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user) {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }

    const { messageId, reply, attachments: rawAttachments } = await req.json();

    if (!isValidUUID(messageId)) {
      return errorResponse(req, "INVALID_MESSAGE_ID", 400);
    }
    if (typeof reply !== "string" || reply.trim().length === 0 || reply.length > 5000) {
      return errorResponse(req, "REPLY_REQUIRED", 400);
    }

    const attachmentCheck = shapeCheckAttachments(rawAttachments, (p) =>
      isOrganizerReplyAttachmentPath(p, messageId),
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

    const { messages } = await adminDb.query({
      messages: {
        $: { where: { id: messageId } },
        concert: {
          collaborators: {},
        },
      },
    });

    const message = messages[0];
    if (!message) {
      return errorResponse(req, "MESSAGE_NOT_FOUND", 404);
    }

    const rawConcert = message.concert as unknown;
    const concert = Array.isArray(rawConcert) ? rawConcert[0] : rawConcert;
    const eventName = concert?.name ?? "Event";

    const { isAuthorizedForConcert } = await import("@/lib/authHelpers");
    if (
      !user.email ||
      !isAuthorizedForConcert(user.email, {
        organizerEmail: concert?.organizerEmail ?? "",
        collaborators: concert?.collaborators,
      })
    ) {
      return errorResponse(req, "UNAUTHORIZED", 401);
    }

    if (attachments.length > 0) {
      const verify = await verifyAttachmentsExist(adminDb, attachments);
      if (!verify.ok) {
        return errorResponse(req, "ATTACHMENT_MISSING", 400);
      }
    }

    const now = Date.now();
    const replyId = id();
    const replyBody = reply.trim();
    const attachmentsJson = stringifyAttachments(attachments);

    // Rotate token if missing/expired so the magic link in the email is fresh.
    const currentToken = (message as { accessToken?: string }).accessToken;
    const currentExpiry = (message as { tokenExpiresAt?: number }).tokenExpiresAt ?? 0;
    const needsNewToken = !currentToken || currentExpiry < now;
    const accessToken = needsNewToken ? generateInviteToken() : currentToken!;
    const tokenExpiresAt = now + TOKEN_TTL_MS;

    const replyTx = adminDb.tx.messageReplies[replyId]
      .create({
        body: replyBody,
        sender: "organizer",
        authorEmail: user.email,
        attachments: attachmentsJson ?? undefined,
        createdAt: now,
      })
      .link({ message: messageId });

    const messageUpdate: Record<string, unknown> = {
      status: "replied",
      adminReply: replyBody,
      repliedAt: now,
      lastActivityAt: now,
      tokenExpiresAt,
    };
    if (needsNewToken) {
      messageUpdate.accessToken = accessToken;
    }

    await adminDb.transact([
      replyTx,
      adminDb.tx.messages[messageId].update(messageUpdate),
    ]);

    if (await isEmailSuppressed(message.email)) {
      console.log(`[reply-message] Skipping suppressed email: ${message.email}`);
      return NextResponse.json({ success: true });
    }

    const lang = resolveEmailLang(
      (message as { language?: string }).language,
      (concert as { defaultLanguage?: string })?.defaultLanguage,
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matickets.net";
    const threadUrl = `${appUrl}/${lang}/messages/${accessToken}`;

    const emailParams = {
      firstName: message.firstName,
      eventName,
      subject: message.subject,
      threadUrl,
      attachmentCount: attachments.length,
      lang,
    };

    const tSubj = await getTranslations({ locale: lang, namespace: "emails.reply" });

    await transporter.sendMail({
      from: `"maTickets" <${EMAIL_FROM}>`,
      to: message.email,
      subject: tSubj("subject", { subject: message.subject }),
      messageId: generateMessageId(),
      text: await buildReplyEmailText(emailParams),
      html: await buildReplyEmailHtml(emailParams),
      headers: {
        ...buildMailHeaders(message.email),
        "Referrer-Policy": "no-referrer",
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[reply-message] error:", err);
    return errorResponse(req, "INTERNAL_ERROR", 500);
  }
}
