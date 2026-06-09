import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { assertOrganizerCanAccessConcert } from "@/lib/authHelpers";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import {
  buildCollaboratorInviteEmailHtml,
  buildCollaboratorInviteEmailText,
} from "@/lib/collaboratorInviteEmailTemplate";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { resolveEmailLang } from "@/lib/serverLocale";
import { getTranslations } from "next-intl/server";
import { recordAuditLog } from "@/lib/auditLog";

export const maxDuration = 60;

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
    const concertId: string = body.concertId;
    const collaboratorId: string = body.collaboratorId;
    if (!concertId || typeof concertId !== "string") {
      return NextResponse.json({ error: "concertId required" }, { status: 400 });
    }
    if (!collaboratorId || typeof collaboratorId !== "string") {
      return NextResponse.json(
        { error: "collaboratorId required" },
        { status: 400 },
      );
    }

    const auth = await assertOrganizerCanAccessConcert(user.email, concertId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const concert = auth.data;

    const { eventCollaborators } = await adminDb.query({
      eventCollaborators: {
        $: { where: { id: collaboratorId } },
        concert: {},
      },
    });
    const collaborator = eventCollaborators[0] as
      | { id: string; email?: string; concert?: unknown }
      | undefined;
    if (!collaborator) {
      return NextResponse.json(
        { error: "Collaborator not found" },
        { status: 404 },
      );
    }
    const rawConcert = collaborator.concert as unknown;
    const linkedConcert = (
      Array.isArray(rawConcert) ? rawConcert[0] : rawConcert
    ) as { id: string } | undefined;
    if (!linkedConcert || linkedConcert.id !== concertId) {
      return NextResponse.json(
        { error: "Collaborator does not belong to this event" },
        { status: 400 },
      );
    }
    const email = collaborator.email;
    if (!email) {
      return NextResponse.json(
        { error: "Collaborator has no email" },
        { status: 400 },
      );
    }

    if (await isEmailSuppressed(email)) {
      return NextResponse.json({ sent: false, suppressed: true });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const emailLang = resolveEmailLang(undefined, concert.defaultLanguage);
    const manageUrl = `${appUrl}/${emailLang}/admin/concerts/${concertId}`;
    const tEmail = await getTranslations({
      locale: emailLang,
      namespace: "emails.collaboratorInvite",
    });

    const html = await buildCollaboratorInviteEmailHtml({
      eventName: concert.name,
      organizerEmail: concert.organizerEmail,
      inviteEmail: email,
      manageUrl,
      primaryColor: concert.primaryColor,
      lang: emailLang,
    });
    const text = await buildCollaboratorInviteEmailText({
      eventName: concert.name,
      organizerEmail: concert.organizerEmail,
      inviteEmail: email,
      manageUrl,
      lang: emailLang,
    });

    await transporter.sendMail({
      from: `"maTickets" <${EMAIL_FROM}>`,
      replyTo: concert.organizerEmail,
      to: email,
      subject: tEmail("subject", { eventName: concert.name }),
      html,
      text,
      messageId: generateMessageId(),
      date: new Date(),
      envelope: { from: EMAIL_FROM, to: email },
      headers: buildMailHeaders(email),
    });

    await adminDb.transact([
      adminDb.tx.eventCollaborators[collaboratorId].update({
        inviteSentAt: Date.now(),
      }),
    ]);

    await recordAuditLog({
      action: "collab.invite.sent",
      actorEmail: user.email,
      entityType: "concert",
      entityId: concertId,
      concertId,
      summary: `Envió invitación de colaborador a ${email} en ${concert.name}`,
      metadata: { collaboratorEmail: email },
    });

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[concerts/send-collaborator-invite] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
