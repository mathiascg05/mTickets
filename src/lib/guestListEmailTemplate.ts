import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { escapeHtml } from "./emailTemplate";

type EmailLang = (typeof routing.locales)[number];

function normalizeLang(lang: string | undefined | null): EmailLang {
  if (lang && (routing.locales as readonly string[]).includes(lang)) {
    return lang as EmailLang;
  }
  return routing.defaultLocale as EmailLang;
}

export async function buildGuestInviteEmailHtml(params: {
  firstName?: string;
  eventName: string;
  eventDate: string;
  venue: string;
  priceLabel: string;
  inviteUrl: string;
  organizerEmail: string;
  primaryColor?: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.guestInvite" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const firstName = params.firstName?.trim() || "";
  const eventName = escapeHtml(params.eventName);
  const eventDate = escapeHtml(params.eventDate);
  const venue = escapeHtml(params.venue);
  const priceLabel = escapeHtml(params.priceLabel);
  const inviteUrl = escapeHtml(params.inviteUrl);
  const organizerEmail = escapeHtml(params.organizerEmail);
  const brandColor = params.primaryColor || "#1a2b4a";

  const greeting = firstName
    ? escapeHtml(tCommon("greetingShort", { firstName }))
    : escapeHtml(tCommon("greetingFallback"));
  const footer = escapeHtml(tCommon("footer"));
  const intro = escapeHtml(t("intro", { eventName: params.eventName }));
  const cta = escapeHtml(t("cta"));
  const priceHeader = escapeHtml(t("priceHeader"));
  const linkNote = escapeHtml(t("linkNote"));
  const footerNote = escapeHtml(
    t("footerNote", { eventName: params.eventName, organizerEmail: params.organizerEmail }),
  );

  const hex = brandColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lighter = `rgb(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)})`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg, ${brandColor} 0%, ${lighter} 100%);padding:28px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 12px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">${greeting}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:18px;font-weight:700;color:${brandColor};">${eventName}</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#7a8599;">${eventDate} &middot; ${venue}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:14px 20px 6px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${priceHeader}</p>
                  <p style="margin:4px 0 0;font-size:18px;color:#1a2b4a;font-weight:700;">${priceLabel}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 32px 24px;">
            <a href="${inviteUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg, ${brandColor} 0%, ${lighter} 100%);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">${cta}</a>
            <p style="margin:12px 0 0;font-size:11px;color:#7a8599;word-break:break-all;">${linkNote} <br /><a href="${inviteUrl}" style="color:${brandColor};">${inviteUrl}</a></p>
          </td>
        </tr>
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

export async function buildGuestInviteEmailText(params: {
  firstName?: string;
  eventName: string;
  eventDate: string;
  venue: string;
  priceLabel: string;
  inviteUrl: string;
  organizerEmail: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.guestInvite" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const greeting = params.firstName
    ? tCommon("greetingShort", { firstName: params.firstName })
    : tCommon("greetingFallback");
  const footer = tCommon("footer");

  return `maTickets
========

${greeting}

${t("intro", { eventName: params.eventName })}

--- ${params.eventName} ---

${t("labelDate")}: ${params.eventDate}
${t("labelVenue")}: ${params.venue}
${t("priceHeader")}: ${params.priceLabel}

---

${t("cta")}: ${params.inviteUrl}

${t("footerNote", { eventName: params.eventName, organizerEmail: params.organizerEmail })}

${footer}
`;
}

export async function buildGuestTicketEmailHtml(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  pricePaidLabel: string;
  ticketUrl: string;
  orderNumber: string;
  primaryColor?: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.guestTicket" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const firstName = params.firstName;
  const lastName = params.lastName;
  const eventName = escapeHtml(params.eventName);
  const eventDate = escapeHtml(params.eventDate);
  const venue = escapeHtml(params.venue);
  const pricePaidLabel = escapeHtml(params.pricePaidLabel);
  const orderNumber = escapeHtml(params.orderNumber);
  const ticketUrl = escapeHtml(params.ticketUrl);
  const brandColor = params.primaryColor || "#1a2b4a";

  const hex = brandColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lighter = `rgb(${Math.min(255, r + 40)},${Math.min(255, g + 40)},${Math.min(255, b + 40)})`;

  const greeting = escapeHtml(tCommon("greeting", { firstName, lastName }));
  const footer = escapeHtml(tCommon("footer"));
  const intro = escapeHtml(t("intro"));
  const saveButton = escapeHtml(t("saveButton"));
  const labelDate = escapeHtml(t("labelDate"));
  const labelVenue = escapeHtml(t("labelVenue"));
  const labelPaid = escapeHtml(t("labelPaid"));

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(26,43,74,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg, ${brandColor} 0%, ${lighter} 100%);padding:28px 32px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">ma<span style="color:rgba(255,255,255,0.6);">Tickets</span></h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 12px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">${greeting}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">${intro}</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg, rgba(${r},${g},${b},0.08) 0%, rgba(${r},${g},${b},0.04) 100%);border-radius:16px;border:1px solid rgba(${r},${g},${b},0.12);">
              <tr><td style="padding:24px 32px;text-align:center;">
                <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:${brandColor};">${eventName}</p>
                <p style="margin:0 0 16px;font-size:13px;color:#7a8599;">${eventDate} &middot; ${venue}</p>
                <div style="background-color:#ffffff;border-radius:12px;padding:16px;display:inline-block;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
                  <img src="cid:qr-code@matickets" alt="QR Ticket" width="200" height="200" style="display:block;border:0;" />
                </div>
                <p style="margin:12px 0 0;font-size:14px;font-weight:700;font-family:monospace;color:${brandColor};letter-spacing:1px;">${orderNumber}</p>
                <p style="margin:8px 0 0;font-size:12px;color:#7a8599;">${pricePaidLabel}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:4px 32px 20px;">
            <a href="${ticketUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg, ${brandColor} 0%, ${lighter} 100%);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">${saveButton}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
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
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">${labelPaid}</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${pricePaidLabel}</p>
                </td>
              </tr>
            </table>
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

export async function buildGuestTicketEmailText(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  pricePaidLabel: string;
  ticketUrl: string;
  orderNumber: string;
  lang?: string;
}) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.guestTicket" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const greeting = tCommon("greeting", {
    firstName: params.firstName,
    lastName: params.lastName,
  });
  const footer = tCommon("footer");

  return `maTickets
========

${greeting}

${t("intro")}

${t("labelOrderNumber")}: ${params.orderNumber}

--- ${params.eventName} ---

${t("labelDate")}: ${params.eventDate}
${t("labelVenue")}: ${params.venue}
${t("labelPaid")}: ${params.pricePaidLabel}

---

${t("saveButton")}: ${params.ticketUrl}

${footer}
`;
}
