import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

export const transporter = nodemailer.createTransport({
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
});

export function generateMessageId(): string {
  const domain = (process.env.GMAIL_USER || "matickets.com").split("@")[1] || "matickets.com";
  return `<${randomUUID()}@${domain}>`;
}
