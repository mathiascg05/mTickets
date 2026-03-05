async function postEmail(
  url: string,
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
): Promise<{ success: boolean; error?: string }> {
  return postEmail("/api/send-ticket-email", orderId);
}

export function sendConfirmationEmail(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  return postEmail("/api/send-confirmation-email", orderId);
}
