import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { buildBroadcastEmailHtml, buildBroadcastEmailText } from "@/lib/emailTemplate";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { resolveEmailLang } from "@/lib/serverLocale";
import type { BroadcastRecipient } from "@/lib/broadcastRecipients";

// Tuned for Resend Pro (10 req/s). Bursts of 5 every 600ms = ~8.3 req/s
// sustained, comfortably under the limit. If you upgrade Resend's plan or
// switch back to free, adjust here.
export const CHUNK_SIZE = 5;
export const CHUNK_DELAY_MS = 600;
export const RATE_LIMIT_RETRIES = 3;
export const RATE_LIMIT_BACKOFF_MS = [2000, 4000, 8000];

export type SendResult =
  | { ok: true }
  | { ok: false; reason: string; transient: boolean };

export type FailedEmailEntry = { email: string; reason: string };

export type BroadcastEmailParams = {
  eventName: string;
  subject: string;
  body: string;
  organizerEmail: string;
  concertDefaultLanguage?: string;
};

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Rate-limit / throttling.
  if (
    msg.includes("429") ||
    msg.includes("too many") ||
    msg.includes("rate limit") ||
    msg.includes(" 421 ") ||
    msg.startsWith("421 ")
  ) {
    return true;
  }
  // Network / connection blips.
  if (
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    msg.includes("socket hang up") ||
    msg.includes("network timeout")
  ) {
    return true;
  }
  // Generic SMTP 4xx (transient by spec). Match a standalone 4xx in the message.
  if (/(^|\s)4\d{2}(\s|$)/.test(msg)) return true;
  return false;
}

// Back-compat alias — the old name was misleading once we added more transient
// classes, but external callers (and tests) may still use it.
export const isRateLimitError = isTransientError;

export async function sendOneEmail(
  recipient: BroadcastRecipient,
  params: BroadcastEmailParams,
): Promise<SendResult> {
  const lang = resolveEmailLang(recipient.language, params.concertDefaultLanguage);
  const [text, html] = await Promise.all([
    buildBroadcastEmailText({
      firstName: recipient.firstName,
      eventName: params.eventName,
      subject: params.subject,
      body: params.body,
      organizerEmail: params.organizerEmail,
      lang,
    }),
    buildBroadcastEmailHtml({
      firstName: recipient.firstName,
      eventName: params.eventName,
      subject: params.subject,
      body: params.body,
      organizerEmail: params.organizerEmail,
      lang,
    }),
  ]);

  let lastErr: unknown;
  let lastWasTransient = false;
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt++) {
    try {
      await transporter.sendMail({
        from: `"maTickets" <${EMAIL_FROM}>`,
        to: recipient.email,
        subject: params.subject,
        messageId: generateMessageId(),
        text,
        html,
        headers: buildMailHeaders(recipient.email),
      });
      return { ok: true };
    } catch (err) {
      lastErr = err;
      lastWasTransient = isTransientError(err);
      if (attempt < RATE_LIMIT_RETRIES && lastWasTransient) {
        await sleep(RATE_LIMIT_BACKOFF_MS[attempt] ?? 8000);
        continue;
      }
      break;
    }
  }

  console.error(`[broadcast] Failed to send to ${recipient.email}:`, lastErr);
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { ok: false, reason, transient: lastWasTransient };
}

export type BatchResult = {
  sentCount: number;
  failedCount: number;
  failedEmails: FailedEmailEntry[];
};

export async function sendBatch(
  recipients: BroadcastRecipient[],
  params: BroadcastEmailParams,
): Promise<BatchResult> {
  let sentCount = 0;
  let failedCount = 0;
  const failedEmails: FailedEmailEntry[] = [];

  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(chunk.map((r) => sendOneEmail(r, params)));
    results.forEach((res, idx) => {
      if (res.ok) {
        sentCount++;
      } else {
        failedCount++;
        failedEmails.push({ email: chunk[idx].email, reason: res.reason });
      }
    });
    if (i + CHUNK_SIZE < recipients.length) {
      await sleep(CHUNK_DELAY_MS);
    }
  }

  return { sentCount, failedCount, failedEmails };
}
