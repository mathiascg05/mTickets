import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

const useResend = !!process.env.RESEND_API_KEY;
const useSes = !!process.env.SES_SMTP_USER;

// Pool is sized to stay under provider rate limits when we send many emails in
// a row (e.g. broadcast campaigns). Resend free is 2 req/s, so 2 connections +
// a throttled caller keeps us within budget. Both SES and Gmail are also fine
// with 2.
export const transporter = nodemailer.createTransport(
  useResend
    ? {
        pool: true,
        maxConnections: 2,
        maxMessages: Infinity,
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        auth: {
          user: "resend",
          pass: process.env.RESEND_API_KEY!,
        },
      }
    : useSes
      ? {
          pool: true,
          maxConnections: 2,
          maxMessages: Infinity,
          host: `email-smtp.${process.env.SES_REGION || "us-east-1"}.amazonaws.com`,
          port: 465,
          secure: true,
          auth: {
            user: process.env.SES_SMTP_USER!,
            pass: process.env.SES_SMTP_PASSWORD!,
          },
        }
      : {
          pool: true,
          maxConnections: 2,
          maxMessages: Infinity,
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
          },
        },
);

export const EMAIL_FROM = process.env.EMAIL_FROM || process.env.GMAIL_USER || "tickets@matickets.net";

export function generateMessageId(): string {
  const domain = EMAIL_FROM.split("@")[1] || "matickets.net";
  return `<${randomUUID()}@${domain}>`;
}
