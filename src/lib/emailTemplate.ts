export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildConfirmationEmailHtml(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  price: string;
  orderUrl: string;
  orderNumber?: string;
}) {
  const firstName = escapeHtml(params.firstName);
  const lastName = escapeHtml(params.lastName);
  const eventName = escapeHtml(params.eventName);
  const eventDate = escapeHtml(params.eventDate);
  const venue = escapeHtml(params.venue);
  const ticketTypeName = escapeHtml(params.ticketTypeName);
  const price = escapeHtml(params.price);
  const orderUrl = escapeHtml(params.orderUrl);
  const orderNumber = params.orderNumber ? escapeHtml(params.orderNumber) : undefined;

  return `<!DOCTYPE html>
<html lang="en">
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
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">Hi ${firstName} ${lastName},</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">Your order has been received. We are reviewing your payment proof.</p>
          </td>
        </tr>
        <!-- Status Icon -->
        <tr>
          <td align="center" style="padding:16px 32px;">
            <div style="background-color:#fef3c7;border-radius:12px;padding:24px;display:inline-block;">
              <div style="font-size:48px;line-height:1;">&#9203;</div>
              <p style="margin:8px 0 0;font-size:14px;color:#92400e;font-weight:600;">Payment under review</p>
            </div>
          </td>
        </tr>
        <!-- Event Details -->
        <tr>
          <td style="padding:8px 32px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              ${orderNumber ? `<tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Order Number</p>
                  <p style="margin:2px 0 0;font-size:18px;color:#1a2b4a;font-weight:700;font-family:monospace;">${orderNumber}</p>
                </td>
              </tr>` : ""}
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Event</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventDate}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Venue</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${venue}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Ticket Type</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${ticketTypeName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Price</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${price}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Info -->
        <tr>
          <td style="padding:0 32px 28px;text-align:center;">
            <p style="margin:0;font-size:14px;color:#7a8599;line-height:1.5;">You will receive a new email with your QR code once your payment is approved.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">maTickets &mdash; Digital ticketing system</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildConfirmationEmailText(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  price: string;
  orderUrl: string;
  orderNumber?: string;
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, orderUrl, orderNumber } = params;

  return `maTickets
========

Hi ${firstName} ${lastName},

Your order has been received. We are reviewing your payment proof.
${orderNumber ? `\nOrder Number: ${orderNumber}\n` : ""}
--- Event Details ---

Event: ${eventName}
Date: ${eventDate}
Venue: ${venue}
Ticket Type: ${ticketTypeName}
Price: ${price}

---

You will receive a new email with your QR code once your payment is approved.

maTickets - Digital ticketing system
`;
}

export function buildTicketEmailText(params: {
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
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, ticketUrl, orderNumber, ticketPageUrl } = params;

  return `maTickets
========

Hi ${firstName} ${lastName},

Your ticket has been approved. Show the attached QR code at the event entrance.
${orderNumber ? `\nOrder Number: ${orderNumber}\n` : ""}
--- Event Details ---

Event: ${eventName}
Date: ${eventDate}
Venue: ${venue}
Ticket Type: ${ticketTypeName}
Price: ${price}

---

View your ticket online: ${ticketUrl}
${ticketPageUrl ? `\nSave your ticket as a beautiful image: ${ticketPageUrl}\n` : ""}
If you can't see the QR code in the email body, you'll find it as an attachment (ticket-qr.png).

maTickets - Digital ticketing system
`;
}

export function buildTicketEmailHtml(params: {
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
}) {
  const firstName = escapeHtml(params.firstName);
  const lastName = escapeHtml(params.lastName);
  const eventName = escapeHtml(params.eventName);
  const eventDate = escapeHtml(params.eventDate);
  const venue = escapeHtml(params.venue);
  const ticketTypeName = escapeHtml(params.ticketTypeName);
  const price = escapeHtml(params.price);
  const ticketUrl = escapeHtml(params.ticketUrl);
  const orderNumber = params.orderNumber ? escapeHtml(params.orderNumber) : undefined;
  const brandColor = params.primaryColor || "#1a2b4a";
  const ticketPageUrl = params.ticketPageUrl ? escapeHtml(params.ticketPageUrl) : undefined;

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
<html lang="en">
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
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">Hi ${firstName} ${lastName},</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">Your ticket has been approved! Show the QR code below at the event entrance.</p>
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
            <a href="${ticketPageUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg, ${brandColor} 0%, ${lighterColor} 100%);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:600;letter-spacing:0.3px;">Guardar mi entrada</a>
            <p style="margin:8px 0 0;font-size:12px;color:#7a8599;">Guarda tu entrada como imagen en tu dispositivo</p>
          </td>
        </tr>` : ""}
        <!-- Event Details -->
        <tr>
          <td style="padding:8px 32px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Event</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventDate}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Venue</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${venue}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Ticket Type</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${ticketTypeName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Price</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${price}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">maTickets &mdash; Digital ticketing system</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildReplyEmailHtml(params: {
  firstName: string;
  eventName: string;
  subject: string;
  originalMessage: string;
  reply: string;
}) {
  const firstName = escapeHtml(params.firstName);
  const eventName = escapeHtml(params.eventName);
  const subject = escapeHtml(params.subject);
  const originalMessage = escapeHtml(params.originalMessage).replace(/\n/g, "<br />");
  const reply = escapeHtml(params.reply).replace(/\n/g, "<br />");

  return `<!DOCTYPE html>
<html lang="en">
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
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">Hi ${firstName},</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">The organizer of <strong style="color:#1a2b4a;">${eventName}</strong> has replied to your message.</p>
          </td>
        </tr>
        <!-- Reply -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Subject</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">Re: ${subject}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0 0 8px;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Reply</p>
                  <p style="margin:0;font-size:14px;color:#1a2b4a;line-height:1.6;">${reply}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Original message -->
        <tr>
          <td style="padding:0 32px 24px;">
            <p style="margin:0 0 8px;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Your original message</p>
            <div style="padding:12px 16px;background-color:#f5f7fa;border-left:3px solid #d8dde6;border-radius:4px;">
              <p style="margin:0;font-size:13px;color:#7a8599;line-height:1.5;">${originalMessage}</p>
            </div>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">maTickets &mdash; Digital ticketing system</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildReplyEmailText(params: {
  firstName: string;
  eventName: string;
  subject: string;
  originalMessage: string;
  reply: string;
}) {
  const { firstName, eventName, subject, originalMessage, reply } = params;

  return `maTickets
========

Hi ${firstName},

The organizer of ${eventName} has replied to your message.

--- Re: ${subject} ---

${reply}

--- Your original message ---

${originalMessage}

---

maTickets - Digital ticketing system
`;
}

export function buildBroadcastEmailHtml(params: {
  firstName: string;
  eventName: string;
  subject: string;
  body: string;
  organizerEmail: string;
}) {
  const firstName = escapeHtml(params.firstName || "");
  const eventName = escapeHtml(params.eventName);
  const subject = escapeHtml(params.subject);
  const body = escapeHtml(params.body).replace(/\n/g, "<br />");
  const organizerEmail = escapeHtml(params.organizerEmail);
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";

  return `<!DOCTYPE html>
<html lang="es">
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
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">El organizador de <strong style="color:#1a2b4a;">${eventName}</strong> te ha enviado un mensaje.</p>
          </td>
        </tr>
        <!-- Subject + Body -->
        <tr>
          <td style="padding:8px 32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Asunto</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${subject}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0 0 8px;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Mensaje</p>
                  <p style="margin:0;font-size:14px;color:#1a2b4a;line-height:1.6;">${body}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0 0 4px;font-size:12px;color:#7a8599;">Este mensaje fue enviado por el organizador de <strong>${eventName}</strong>.</p>
            <p style="margin:0;font-size:12px;color:#7a8599;">Para responder al organizador, escribe a <a href="mailto:${organizerEmail}" style="color:#1a2b4a;text-decoration:underline;">${organizerEmail}</a>.</p>
            <p style="margin:12px 0 0;font-size:12px;color:#7a8599;">maTickets &mdash; Digital ticketing system</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildBroadcastEmailText(params: {
  firstName: string;
  eventName: string;
  subject: string;
  body: string;
  organizerEmail: string;
}) {
  const { firstName, eventName, subject, body, organizerEmail } = params;
  const greeting = firstName ? `Hola ${firstName},` : "Hola,";

  return `maTickets
========

${greeting}

El organizador de ${eventName} te ha enviado un mensaje.

--- ${subject} ---

${body}

---

Este mensaje fue enviado por el organizador de ${eventName}.
Para responder, escribe a ${organizerEmail}.

maTickets - Digital ticketing system
`;
}
