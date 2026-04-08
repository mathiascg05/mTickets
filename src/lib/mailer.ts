import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

const useSes = !!process.env.SES_SMTP_USER;

export const transporter = nodemailer.createTransport(
  useSes
    ? {
        pool: true,
        maxConnections: 1,
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
        maxConnections: 1,
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
