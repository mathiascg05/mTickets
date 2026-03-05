const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postWithRetry(
  url: string,
  orderId: string,
  retries = 3,
  delayMs = 2000,
): Promise<{ success: boolean; error?: string }> {
  await wait(delayMs); // initial delay for InstantDB sync
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (res.ok) return { success: true };
      // If order not found, it may not have synced yet — retry
      if (res.status === 404 && i < retries - 1) {
        await wait(delayMs);
        continue;
      }
      return { success: false, error: data.error || "Unknown error" };
    } catch (err) {
      if (i < retries - 1) {
        await wait(delayMs);
        continue;
      }
      return { success: false, error: (err as Error).message };
    }
  }
  return { success: false, error: "Max retries reached" };
}

export function sendTicketEmail(orderId: string): Promise<{ success: boolean; error?: string }> {
  return postWithRetry("/api/send-ticket-email", orderId);
}

export function sendConfirmationEmail(orderId: string): Promise<{ success: boolean; error?: string }> {
  return postWithRetry("/api/send-confirmation-email", orderId);
}
