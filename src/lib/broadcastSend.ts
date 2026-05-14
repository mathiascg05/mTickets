import { transporter, generateMessageId, EMAIL_FROM } from "@/lib/mailer";
import { buildBroadcastEmailHtml, buildBroadcastEmailText } from "@/lib/emailTemplate";
import { buildMailHeaders } from "@/lib/emailHeaders";
import { resolveEmailLang } from "@/lib/serverLocale";
import type { BroadcastRecipient } from "@/lib/broadcastRecipients";

// Resend free is 2 req/s. Keep chunks small and pause between them so we never
// exceed the provider's rate limit (which used to surface as ~70% failure rate
// on bursts of 35+ recipients).
export const CHUNK_SIZE = 2;
export const CHUNK_DELAY_MS = 1100;
export const RATE_LIMIT_RETRIES = 2;
export const RATE_LIMIT_BACKOFF_MS = [2000, 4000];

export type SendResult = { ok: true } | { ok: false; reason: string };

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

export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  // Resend returns 429 / "Too many requests"; nodemailer surfaces SMTP 421
  // ("Service not available") for throttled connections.
  return (
    msg.includes("429") ||
    msg.includes("too many") ||
    msg.includes("rate limit") ||
    msg.includes(" 421 ") ||
    msg.startsWith("421 ")
  );
}

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
      if (attempt < RATE_LIMIT_RETRIES && isRateLimitError(err)) {
        await sleep(RATE_LIMIT_BACKOFF_MS[attempt] ?? 4000);
        continue;
      }
      break;
    }
  }

  console.error(`[broadcast] Failed to send to ${recipient.email}:`, lastErr);
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { ok: false, reason };
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
