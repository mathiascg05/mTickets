export function buildConfirmationEmailHtml(params: {
  firstName: string;
  lastName: string;
  eventName: string;
  eventDate: string;
  venue: string;
  ticketTypeName: string;
  price: string;
  orderUrl: string;
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, orderUrl } = params;

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
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">maTickets</h1>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">Hola ${firstName} ${lastName},</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">Tu orden ha sido recibida. Estamos revisando tu comprobante de pago.</p>
          </td>
        </tr>
        <!-- Status Icon -->
        <tr>
          <td align="center" style="padding:16px 32px;">
            <div style="background-color:#fef3c7;border-radius:12px;padding:24px;display:inline-block;">
              <div style="font-size:48px;line-height:1;">&#9203;</div>
              <p style="margin:8px 0 0;font-size:14px;color:#92400e;font-weight:600;">Pago en revision</p>
            </div>
          </td>
        </tr>
        <!-- Event Details -->
        <tr>
          <td style="padding:8px 32px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;border-radius:12px;padding:20px;">
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Evento</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Fecha</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventDate}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Lugar</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${venue}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Tipo de Entrada</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${ticketTypeName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Precio</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${price}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- CTA Button -->
        <tr>
          <td align="center" style="padding:0 32px 28px;">
            <a href="${orderUrl}" style="display:inline-block;background-color:#1a2b4a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 32px;border-radius:10px;">Ver Estado de Orden</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">maTickets &mdash; Sistema de boletos digitales</p>
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
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, orderUrl } = params;

  return `maTickets
========

Hola ${firstName} ${lastName},

Tu orden ha sido recibida. Estamos revisando tu comprobante de pago.

--- Detalles del evento ---

Evento: ${eventName}
Fecha: ${eventDate}
Lugar: ${venue}
Tipo de Entrada: ${ticketTypeName}
Precio: ${price}

---

Ver estado de tu orden: ${orderUrl}

maTickets - Sistema de boletos digitales
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
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, ticketUrl } = params;

  return `maTickets
========

Hola ${firstName} ${lastName},

Tu entrada ha sido aprobada. Presenta el codigo QR adjunto en la entrada del evento.

--- Detalles del evento ---

Evento: ${eventName}
Fecha: ${eventDate}
Lugar: ${venue}
Tipo de Entrada: ${ticketTypeName}
Precio: ${price}

---

Ver tu ticket online: ${ticketUrl}

Si no puedes ver el codigo QR en el cuerpo del correo, lo encontraras como archivo adjunto (ticket-qr.png).

maTickets - Sistema de boletos digitales
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
}) {
  const { firstName, lastName, eventName, eventDate, venue, ticketTypeName, price, ticketUrl } = params;

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
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">maTickets</h1>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:32px 32px 16px;">
            <p style="margin:0;font-size:16px;color:#1a2b4a;font-weight:600;">Hola ${firstName} ${lastName},</p>
            <p style="margin:8px 0 0;font-size:14px;color:#7a8599;line-height:1.5;">Tu entrada ha sido aprobada. Presenta el siguiente codigo QR en la entrada del evento.</p>
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
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Evento</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Fecha</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${eventDate}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Lugar</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${venue}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Tipo de Entrada</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${ticketTypeName}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 20px;">
                  <p style="margin:0;font-size:12px;color:#7a8599;text-transform:uppercase;letter-spacing:0.5px;">Precio</p>
                  <p style="margin:2px 0 0;font-size:15px;color:#1a2b4a;font-weight:600;">${price}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- CTA Button -->
        <tr>
          <td align="center" style="padding:0 32px 28px;">
            <a href="${ticketUrl}" style="display:inline-block;background-color:#1a2b4a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 32px;border-radius:10px;">Ver Ticket</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #d8dde6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#7a8599;">maTickets &mdash; Sistema de boletos digitales</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
