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
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, orderUrl, orderNumber } = params;

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
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">maTickets</h1>
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
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, ticketUrl, orderNumber } = params;

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
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, ticketUrl, orderNumber } = params;

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
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">maTickets</h1>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">Hi ${firstName} ${lastName},</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">Your ticket has been approved. Show the QR code below at the event entrance.</p>
          </td>
        </tr>
        <!-- QR Code -->
        <tr>
          <td align="center" style="padding:16px 32px;">
            <div style="background-color:#f5f7fa;border-radius:12px;padding:24px;display:inline-block;">
              <img src="cid:qr-code@matickets" alt="QR Ticket" width="200" height="200" style="display:block;border:0;" />
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
