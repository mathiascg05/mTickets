import { buildUnsubscribeUrl } from "@/lib/unsubscribeToken";

export function buildMailHeaders(recipientEmail: string) {
  const unsubUrl = buildUnsubscribeUrl(recipientEmail);
  return {
    "List-Unsubscribe": `<${unsubUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    "X-Mailer": "maTickets",
  };
}
