import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { isEmailSuppressed } from "@/lib/emailSuppression";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { resolveEmailLang } from "@/lib/serverLocale";
import { recordAuditLog } from "@/lib/auditLog";

export const maxDuration = 60;

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

function buildEmail(args: {
  lang: string;
  schoolName: string;
  eventName: string;
  ticketCount: number;
  totalPrice: number;
  manageUrl: string;
}) {
  const es = args.lang === "es";
  const subject = es
    ? `Tu lote de entradas para ${args.eventName}`
    : `Your ticket batch for ${args.eventName}`;
  const line1 = es
    ? `Hola ${args.schoolName}, se les asignó un lote de ${args.ticketCount} entradas para ${args.eventName}.`
    : `Hi ${args.schoolName}, a batch of ${args.ticketCount} tickets for ${args.eventName} has been assigned to you.`;
  const line2 = es
    ? `Gestionen el pago del lote y reciban sus códigos QR desde este enlace:`
    : `Manage the batch payment and get your QR codes from this link:`;
  const cta = es ? "Gestionar mi lote" : "Manage my batch";
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 12px">${args.eventName}</h2>
    <p>${line1}</p>
    <p>${line2}</p>
    <p style="margin:24px 0"><a href="${args.manageUrl}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${cta}</a></p>
    <p style="color:#666;font-size:13px;word-break:break-all">${args.manageUrl}</p>
  </div>`;
  const text = `${line1}\n\n${line2}\n${args.manageUrl}`;
  return { subject, html, text };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!authToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await adminDb.auth.verifyToken(authToken);
    if (!user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: {
        $: { where: { id } },
        concert: { collaborators: {} },
      },
    });
    const allotment = ticketAllotments[0];
    if (!allotment) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const concert = firstOf<{
      id: string;
      name: string;
      organizerEmail: string;
      defaultLanguage?: string;
      collaborators?: { email: string }[];
    }>(allotment.concert);
    if (!concert || !isAuthorizedForConcert(user.email, concert)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const email = allotment.contactEmail as string | undefined;
    if (!email) {
      return NextResponse.json({ error: "NO_CONTACT_EMAIL" }, { status: 400 });
    }
    if (!allotment.manageToken) {
      return NextResponse.json({ error: "TOKEN_REVOKED" }, { status: 410 });
    }
    if (await isEmailSuppressed(email)) {
      return NextResponse.json({ sent: false, suppressed: true });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const lang = resolveEmailLang(
      allotment.language as string | undefined,
      concert.defaultLanguage,
    );
    const manageUrl = `${appUrl}/${lang}/allotment/${allotment.manageToken}`;
    const { subject, html, text } = buildEmail({
      lang,
      schoolName: allotment.schoolName as string,
      eventName: concert.name,
      ticketCount: allotment.ticketCount as number,
      totalPrice: allotment.totalPrice as number,
      manageUrl,
    });

    await transporter.sendMail({
      from: `"maTickets" <${EMAIL_FROM}>`,
      replyTo: concert.organizerEmail,
      to: email,
      subject,
      html,
      text,
      messageId: generateMessageId(),
      date: new Date(),
      envelope: { from: EMAIL_FROM, to: email },
      headers: buildMailHeaders(email),
    });

    await adminDb.transact([
      adminDb.tx.ticketAllotments[id].update({ inviteSentAt: Date.now() }),
    ]);

    await recordAuditLog({
      action: "allotment.link.sent",
      actorEmail: user.email,
      entityType: "allotment",
      entityId: id,
      concertId: concert.id,
      summary: `Envió el enlace del lote a ${email}`,
      metadata: { email },
    });

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[allotments:send-link] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
