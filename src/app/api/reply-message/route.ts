import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidUUID } from "@/lib/validation";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { buildReplyEmailHtml, buildReplyEmailText } from "@/lib/emailTemplate";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";

export async function POST(req: NextRequest) {
  try {
    // Verify caller is authenticated
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { messageId, reply } = await req.json();

    if (!isValidUUID(messageId)) {
      return NextResponse.json({ error: "Invalid message ID." }, { status: 400 });
    }
    if (typeof reply !== "string" || reply.trim().length === 0 || reply.length > 5000) {
      return NextResponse.json({ error: "Reply is required (max 5000 chars)." }, { status: 400 });
    }

    // Fetch message with its concert (and collaborators for auth)
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
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }

    const rawConcert = message.concert as unknown;
    const concert = Array.isArray(rawConcert) ? rawConcert[0] : rawConcert;
    const eventName = concert?.name ?? "Event";

    // Verify user is organizer/collaborator of this concert or super admin
    const { isAuthorizedForConcert } = await import("@/lib/authHelpers");
    if (
      !user.email ||
      !isAuthorizedForConcert(user.email, {
        organizerEmail: concert?.organizerEmail ?? "",
        collaborators: concert?.collaborators,
      })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Update message status
    await adminDb.transact(
      adminDb.tx.messages[messageId].update({
        status: "replied",
        adminReply: reply.trim(),
        repliedAt: Date.now(),
      }),
    );

    // Check suppression (still update message status above, but skip sending)
    if (await isEmailSuppressed(message.email)) {
      console.log(`[reply-message] Skipping suppressed email: ${message.email}`);
      return NextResponse.json({ success: true });
    }

    // Send reply email
    const emailParams = {
      firstName: message.firstName,
      eventName,
      subject: message.subject,
      originalMessage: message.body,
      reply: reply.trim(),
    };

    await transporter.sendMail({
      from: `"maTickets" <${EMAIL_FROM}>`,
      to: message.email,
      subject: `Re: ${message.subject}`,
      messageId: generateMessageId(),
      text: buildReplyEmailText(emailParams),
      html: buildReplyEmailHtml(emailParams),
      headers: buildMailHeaders(message.email),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[reply-message] error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
