import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";

type EmailLang = (typeof routing.locales)[number];

function normalizeLang(lang: string | undefined | null): EmailLang {
  if (lang && (routing.locales as readonly string[]).includes(lang)) {
    return lang as EmailLang;
  }
  return routing.defaultLocale as EmailLang;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function buildConfirmationEmailHtml(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  price: string;
  orderUrl: string;
  orderNumber?: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.confirmation" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const firstName = escapeHtml(params.firstName);
  const lastName = escapeHtml(params.lastName);
  const eventName = escapeHtml(params.eventName);
  const eventDate = escapeHtml(params.eventDate);
  const venue = escapeHtml(params.venue);
  const ticketTypeName = escapeHtml(params.ticketTypeName);
  const price = escapeHtml(params.price);
  const orderNumber = params.orderNumber ? escapeHtml(params.orderNumber) : undefined;

  const greeting = escapeHtml(tCommon("greeting", { firstName: params.firstName, lastName: params.lastName }));
  const footer = escapeHtml(tCommon("footer"));
  const intro = escapeHtml(t("intro"));
  const labelEvent = escapeHtml(t("labelEvent"));
  const labelDate = escapeHtml(t("labelDate"));
  const labelVenue = escapeHtml(t("labelVenue"));
  const labelTicketType = escapeHtml(t("labelTicketType"));
  const labelPrice = escapeHtml(t("labelPrice"));
  const labelOrderNumber = escapeHtml(t("labelOrderNumber"));
  const labelStatus = escapeHtml(t("labelStatus"));
  const introWaiting = escapeHtml(t("introWaiting"));

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <!-- Header -->
        <tr>
          <td style="background-color:#1a2b4a;padding:24px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">${greeting}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <!-- Status Icon -->
        <tr>
          <td align="center" style="padding:16px 32px;">
            <div style="background-color:#fef3c7;border-radius:12px;padding:24px;display:inline-block;">
              <div style="font-size:48px;line-height:1;">&#9203;</div>
              <p style="margin:8px 0 0;font-size:14px;color:#92400e;font-weight:600;">${labelStatus}</p>
            </div>
          </td>
        </tr>
        <!-- Event Details -->
        <tr>
          <td style="padding:8px 32px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              ${orderNumber ? `<tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelOrderNumber}</p>
                  <p style="margin:2px 0 0;font-size:18px;color:#1a2b4a;font-weight:700;font-family:monospace;">${orderNumber}</p>
                </td>
              </tr>` : ""}
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelEvent}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelDate}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventDate}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelVenue}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${venue}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelTicketType}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${ticketTypeName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelPrice}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${price}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Info -->
        <tr>
          <td style="padding:0 32px 28px;text-align:center;">
            <p style="margin:0;font-size:14px;color:#7a8599;line-height:1.5;">${introWaiting}</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">${footer}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function buildConfirmationEmailText(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  price: string;
  orderUrl: string;
  orderNumber?: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.confirmation" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, orderNumber } = params;
  const greeting = tCommon("greeting", { firstName, lastName });
  const footer = tCommon("footer");

  return `maTickets
========

${greeting}

${t("intro")}
${orderNumber ? `\n${t("labelOrderNumber")}: ${orderNumber}\n` : ""}
--- ${t("eventDetailsHeader")} ---

${t("labelEvent")}: ${eventName}
${t("labelDate")}: ${eventDate}
${t("labelVenue")}: ${venue}
${t("labelTicketType")}: ${ticketTypeName}
${t("labelPrice")}: ${price}

---

${t("introWaiting")}

${footer}
`;
}

export async function buildTicketEmailText(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  price: string;
  ticketUrl: string;
  orderNumber?: string;
  ticketPageUrl?: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.ticket" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, ticketUrl, orderNumber, ticketPageUrl } = params;
  const greeting = tCommon("greeting", { firstName, lastName });
  const footer = tCommon("footer");

  return `maTickets
========

${greeting}

${t("intro")}
${orderNumber ? `\n${t("labelOrderNumber")}: ${orderNumber}\n` : ""}
--- ${t("eventDetailsHeader")} ---

${t("labelEvent")}: ${eventName}
${t("labelDate")}: ${eventDate}
${t("labelVenue")}: ${venue}
${t("labelTicketType")}: ${ticketTypeName}
${t("labelPrice")}: ${price}

---

${t("viewOnline")}: ${ticketUrl}
${ticketPageUrl ? `\n${t("saveAsImage")}: ${ticketPageUrl}\n` : ""}
${t("attachmentNote")}

${footer}
`;
}

export async function buildTicketEmailHtml(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  price: string;
  ticketUrl: string;
  orderNumber?: string;
  primaryColor?: string;
  ticketPageUrl?: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.ticket" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const firstName = escapeHtml(params.firstName);
  const lastName = escapeHtml(params.lastName);
  const eventName = escapeHtml(params.eventName);
  const eventDate = escapeHtml(params.eventDate);
  const venue = escapeHtml(params.venue);
  const ticketTypeName = escapeHtml(params.ticketTypeName);
  const price = escapeHtml(params.price);
  const orderNumber = params.orderNumber ? escapeHtml(params.orderNumber) : undefined;
  const brandColor = params.primaryColor || "#1a2b4a";
  const ticketPageUrl = params.ticketPageUrl ? escapeHtml(params.ticketPageUrl) : undefined;

  const greeting = escapeHtml(tCommon("greeting", { firstName: params.firstName, lastName: params.lastName }));
  const footer = escapeHtml(tCommon("footer"));
  const intro = escapeHtml(t("intro"));
  const saveButton = escapeHtml(t("saveButton"));
  const saveHint = escapeHtml(t("saveHint"));
  const labelEvent = escapeHtml(t("labelEvent"));
  const labelDate = escapeHtml(t("labelDate"));
  const labelVenue = escapeHtml(t("labelVenue"));
  const labelTicketType = escapeHtml(t("labelTicketType"));
  const labelPrice = escapeHtml(t("labelPrice"));

  // Derive a lighter shade for gradient
  const hex = brandColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lighterR = Math.min(255, r + 40);
  const lighterG = Math.min(255, g + 40);
  const lighterB = Math.min(255, b + 40);
  const lighterColor = `rgb(${lighterR},${lighterG},${lighterB})`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <!-- Branded Header with event colors -->
        <tr>
          <td style="background:linear-gradient(135deg, ${brandColor} 0%, ${lighterColor} 100%);padding:28px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:28px 32px 12px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">${greeting}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <!-- QR Code with branded background -->
        <tr>
          <td align="center" style="padding:16px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg, rgba(${r},${g},${b},0.08) 0%, rgba(${r},${g},${b},0.04) 100%);border-radius:16px;border:1px solid rgba(${r},${g},${b},0.12);">
              <tr><td style="padding:24px 32px;text-align:center;">
                <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:${brandColor};">${eventName}</p>
                <p style="margin:0 0 16px;font-size:13px;color:#7a8599;">${eventDate} &middot; ${venue}</p>
                <div style="background-color:#ffffff;border-radius:12px;padding:16px;display:inline-block;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
                  <img src="cid:qr-code@matickets" alt="QR Ticket" width="200" height="200" style="display:block;border:0;" />
                </div>
                ${orderNumber ? `<p style="margin:12px 0 0;font-size:14px;font-weight:700;font-family:monospace;color:${brandColor};letter-spacing:1px;">${orderNumber}</p>` : ""}
                <p style="margin:8px 0 0;font-size:12px;color:#7a8599;">${ticketTypeName} &middot; ${price}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        ${ticketPageUrl ? `<!-- Save Ticket Button -->
        <tr>
          <td align="center" style="padding:4px 32px 20px;">
            <a href="${ticketPageUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg, ${brandColor} 0%, ${lighterColor} 100%);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">${saveButton}</a>
            <p style="margin:8px 0 0;font-size:12px;color:#7a8599;">${saveHint}</p>
          </td>
        </tr>` : ""}
        <!-- Event Details -->
        <tr>
          <td style="padding:8px 32px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelEvent}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelDate}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventDate}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelVenue}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${venue}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelTicketType}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${ticketTypeName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelPrice}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${price}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">${footer}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function buildReplyEmailHtml(params: {
  firstName: string;
  eventName: string;
  subject: string;
  threadUrl: string;
  attachmentCount?: number;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.reply" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const eventName = escapeHtml(params.eventName);
  const threadUrl = escapeHtml(params.threadUrl);
  const reLabel = escapeHtml(t("subject", { subject: params.subject }));

  const greeting = escapeHtml(tCommon("greetingShort", { firstName: params.firstName }));
  const footer = escapeHtml(tCommon("footer"));
  const intro = t("intro", { eventName });
  const labelSubject = escapeHtml(t("labelSubject"));
  const cta = escapeHtml(t("cta"));
  const linkNote = escapeHtml(t("linkNote"));
  const attachmentNote =
    params.attachmentCount && params.attachmentCount > 0
      ? escapeHtml(t("attachmentNote", { count: params.attachmentCount }))
      : "";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <tr>
          <td style="background-color:#1a2b4a;padding:24px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">${greeting}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelSubject}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${reLabel}</p>
                </td>
              </tr>
              ${attachmentNote ? `<tr><td style="padding:8px 20px 0;"><p style="margin:0;font-size:13px;color:#7a8599;">${attachmentNote}</p></td></tr>` : ""}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 32px 28px;">
            <a href="${threadUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#1a2b4a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">${cta}</a>
            <p style="margin:12px 0 0;font-size:12px;color:#7a8599;line-height:1.5;word-break:break-all;">${linkNote}<br /><a href="${threadUrl}" style="color:#1a2b4a;">${threadUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">${footer}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function buildReplyEmailText(params: {
  firstName: string;
  eventName: string;
  subject: string;
  threadUrl: string;
  attachmentCount?: number;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.reply" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);
  const { firstName, eventName, subject, threadUrl } = params;
  const greeting = tCommon("greetingShort", { firstName });
  const footer = tCommon("footer");
  const attachmentLine =
    params.attachmentCount && params.attachmentCount > 0
      ? `\n${t("attachmentNote", { count: params.attachmentCount })}\n`
      : "";

  return `maTickets
========

${greeting}

${t("introText", { eventName })}

--- ${t("subject", { subject })} ---
${attachmentLine}
${t("cta")}: ${threadUrl}

---

${footer}
`;
}

export async function buildThreadInviteEmailHtml(params: {
  firstName: string;
  eventName: string;
  subject: string;
  threadUrl: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.threadInvite" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const eventName = escapeHtml(params.eventName);
  const subject = escapeHtml(params.subject);
  const threadUrl = escapeHtml(params.threadUrl);

  const greeting = escapeHtml(tCommon("greetingShort", { firstName: params.firstName }));
  const footer = escapeHtml(tCommon("footer"));
  const intro = t("intro", { eventName });
  const labelSubject = escapeHtml(t("labelSubject"));
  const cta = escapeHtml(t("cta"));
  const linkNote = escapeHtml(t("linkNote"));

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <tr><td style="background-color:#1a2b4a;padding:24px 32px;text-align:center;"><h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1></td></tr>
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">${greeting}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr><td style="padding:6px 20px;">
                <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelSubject}</p>
                <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${subject}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 32px 28px;">
            <a href="${threadUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#1a2b4a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">${cta}</a>
            <p style="margin:12px 0 0;font-size:12px;color:#7a8599;line-height:1.5;word-break:break-all;">${linkNote}<br /><a href="${threadUrl}" style="color:#1a2b4a;">${threadUrl}</a></p>
          </td>
        </tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;"><p style="margin:0;font-size:12px;color:#7a8599;">${footer}</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function buildThreadInviteEmailText(params: {
  firstName: string;
  eventName: string;
  subject: string;
  threadUrl: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.threadInvite" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);
  const { firstName, eventName, subject, threadUrl } = params;
  const greeting = tCommon("greetingShort", { firstName });
  const footer = tCommon("footer");

  return `maTickets
========

${greeting}

${t("introText", { eventName })}

${t("labelSubject")}: ${subject}

${t("cta")}: ${threadUrl}

---

${footer}
`;
}

export async function buildOrganizerNotifyEmailHtml(params: {
  eventName: string;
  customerName: string;
  subject: string;
  inboxUrl: string;
  attachmentCount?: number;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.organizerNotify" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const eventName = escapeHtml(params.eventName);
  const customerName = escapeHtml(params.customerName);
  const subject = escapeHtml(params.subject);
  const inboxUrl = escapeHtml(params.inboxUrl);

  const footer = escapeHtml(tCommon("footer"));
  const intro = t("intro", { eventName, customerName });
  const labelSubject = escapeHtml(t("labelSubject"));
  const cta = escapeHtml(t("cta"));
  const attachmentNote =
    params.attachmentCount && params.attachmentCount > 0
      ? escapeHtml(t("attachmentNote", { count: params.attachmentCount }))
      : "";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <tr><td style="background-color:#1a2b4a;padding:24px 32px;text-align:center;"><h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1></td></tr>
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr><td style="padding:6px 20px;">
                <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelSubject}</p>
                <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${subject}</p>
              </td></tr>
              ${attachmentNote ? `<tr><td style="padding:8px 20px 0;"><p style="margin:0;font-size:13px;color:#7a8599;">${attachmentNote}</p></td></tr>` : ""}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 32px 28px;">
            <a href="${inboxUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#1a2b4a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">${cta}</a>
          </td>
        </tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;"><p style="margin:0;font-size:12px;color:#7a8599;">${footer}</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function buildOrganizerNotifyEmailText(params: {
  eventName: string;
  customerName: string;
  subject: string;
  inboxUrl: string;
  attachmentCount?: number;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.organizerNotify" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);
  const { eventName, customerName, subject, inboxUrl } = params;
  const footer = tCommon("footer");
  const attachmentLine =
    params.attachmentCount && params.attachmentCount > 0
      ? `\n${t("attachmentNote", { count: params.attachmentCount })}\n`
      : "";

  return `maTickets
========

${t("introText", { eventName, customerName })}

${t("labelSubject")}: ${subject}
${attachmentLine}
${t("cta")}: ${inboxUrl}

---

${footer}
`;
}

export async function buildBroadcastEmailHtml(params: {
  firstName: string;
  eventName: string;
  subject: string;
  body: string;
  organizerEmail: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.broadcast" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const firstName = params.firstName || "";
  const eventName = escapeHtml(params.eventName);
  const subject = escapeHtml(params.subject);
  const body = escapeHtml(params.body).replace(/\n/g, "<br />");
  const organizerEmail = escapeHtml(params.organizerEmail);
  const greeting = firstName
    ? escapeHtml(tCommon("greetingShort", { firstName }))
    : escapeHtml(tCommon("greetingFallback"));
  const footer = escapeHtml(tCommon("footer"));
  const intro = t("intro", { eventName });
  const footerNote = t("footer", { eventName, organizerEmail });
  const labelSubject = escapeHtml(t("labelSubject"));
  const labelMessage = escapeHtml(t("labelMessage"));

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <!-- Header -->
        <tr>
          <td style="background-color:#1a2b4a;padding:24px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:32px 32px 8px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">${greeting}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <!-- Subject + Body -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelSubject}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${subject}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0 0 8px;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelMessage}</p>
                  <p style="margin:0;font-size:14px;color:#1a2b4a;line-height:1.6;">${body}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#7a8599;">${footerNote}</p>
            <p style="margin:12px 0 0;font-size:12px;color:#7a8599;">${footer}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function buildBroadcastEmailText(params: {
  firstName: string;
  eventName: string;
  subject: string;
  body: string;
  organizerEmail: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.broadcast" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);
  const { firstName, eventName, subject, body, organizerEmail } = params;
  const greeting = firstName ? tCommon("greetingShort", { firstName }) : tCommon("greetingFallback");
  const footer = tCommon("footer");

  return `maTickets
========

${greeting}

${t("introText", { eventName })}

--- ${subject} ---

${body}

---

${t("footerText", { eventName, organizerEmail })}

${footer}
`;
}
