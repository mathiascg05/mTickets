async function postEmail(
  url: string,
  orderId: string,
  refreshToken: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${refreshToken}`,
      },
      body: JSON.stringify({ orderId }),
      keepalive: true,
    });
    const data = await res.json();
    if (res.ok) return { success: true };
    return { success: false, error: data.error || "Unknown error" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function sendTicketEmail(
  orderId: string,
  refreshToken: string,
): Promise<{ success: boolean; error?: string }> {
  return postEmail("/api/send-ticket-email", orderId, refreshToken);
}

export function sendConfirmationEmail(
  orderId: string,
  refreshToken: string,
): Promise<{ success: boolean; error?: string }> {
  return postEmail("/api/send-confirmation-email", orderId, refreshToken);
}
