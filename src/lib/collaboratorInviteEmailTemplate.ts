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

type CollaboratorInviteParams = {
  eventName: string;
  organizerEmail: string;
  inviteEmail: string;
  manageUrl: string;
  primaryColor?: string;
  lang?: string;
};

export async function buildCollaboratorInviteEmailHtml(
  params: CollaboratorInviteParams,
) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.collaboratorInvite" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const eventName = escapeHtml(params.eventName);
  const manageUrl = escapeHtml(params.manageUrl);
  const brandColor = params.primaryColor || "#1a2b4a";

  const greeting = escapeHtml(tCommon("greetingFallback"));
  const footer = escapeHtml(tCommon("footer"));
  const intro = escapeHtml(t("intro", { eventName: params.eventName }));
  const instruction = escapeHtml(
    t("instruction", { inviteEmail: params.inviteEmail }),
  );
  const cta = escapeHtml(t("cta"));
  const linkNote = escapeHtml(t("linkNote"));
  const footerNote = escapeHtml(
    t("footerNote", {
      eventName: params.eventName,
      organizerEmail: params.organizerEmail,
    }),
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
                <td style="padding:14px 20px;">
                  <p style="margin:0;font-size:18px;font-weight:700;color:${brandColor};">${eventName}</p>
                  <p style="margin:8px 0 0;font-size:13px;color:#7a8599;line-height:1.5;">${instruction}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:8px 32px 24px;">
            <a href="${manageUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg, ${brandColor} 0%, ${lighter} 100%);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">${cta}</a>
            <p style="margin:12px 0 0;font-size:11px;color:#7a8599;word-break:break-all;">${linkNote} <br /><a href="${manageUrl}" style="color:${brandColor};">${manageUrl}</a></p>
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

export async function buildCollaboratorInviteEmailText(
  params: CollaboratorInviteParams,
) {
  const lang = normalizeLang(params.lang);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale: lang, namespace: "emails.collaboratorInvite" }),
    getTranslations({ locale: lang, namespace: "emails.common" }),
  ]);

  const greeting = tCommon("greetingFallback");
  const footer = tCommon("footer");

  return `maTickets
========

${greeting}

${t("intro", { eventName: params.eventName })}

--- ${params.eventName} ---

${t("instruction", { inviteEmail: params.inviteEmail })}

---

${t("cta")}: ${params.manageUrl}

${t("footerNote", { eventName: params.eventName, organizerEmail: params.organizerEmail })}

${footer}
`;
}
