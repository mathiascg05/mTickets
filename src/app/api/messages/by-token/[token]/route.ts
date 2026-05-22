import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isValidToken } from "@/lib/guestListTokens";
import { errorResponse } from "@/lib/serverI18n";
import {
  parseAttachmentsJson,
  attachWithUrls,
  type AttachmentMeta,
  type ResolvedAttachment,
} from "@/lib/imageUpload";

type MessageReplyRow = {
  id: string;
  body: string;
  sender: string;
  attachments?: string;
  createdAt: number;
};

type ConcertLite = {
  id: string;
  name: string;
  slug: string;
  primaryColor?: string;
};

type MessageRow = {
  id: string;
  firstName: string;
  lastName: string;
  subject: string;
  body: string;
  status: string;
  language?: string;
  attachments?: string;
  accessToken?: string | null;
  tokenExpiresAt?: number;
  createdAt: number;
  concert: unknown;
  replies?: MessageReplyRow[];
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await ctx.params;
    if (!isValidToken(token)) {
      return NextResponse.json({ error: "TOKEN_INVALID", code: "TOKEN_INVALID" }, { status: 400 });
    }

    const { messages } = await adminDb.query({
      messages: {
        $: { where: { accessToken: token } },
        replies: { $: { order: { createdAt: "asc" } } },
        concert: {},
      },
    });
    const message = messages[0] as MessageRow | undefined;
    if (!message) {
      return NextResponse.json({ error: "TOKEN_INVALID", code: "TOKEN_INVALID" }, { status: 404 });
    }

    if (!message.accessToken) {
      return NextResponse.json({ error: "TOKEN_REVOKED", code: "TOKEN_REVOKED" }, { status: 410 });
    }
    if (message.tokenExpiresAt && message.tokenExpiresAt < Date.now()) {
      return NextResponse.json({ error: "TOKEN_EXPIRED", code: "TOKEN_EXPIRED" }, { status: 410 });
    }

    const rawConcert = message.concert as unknown;
    const concert = (Array.isArray(rawConcert) ? rawConcert[0] : rawConcert) as
      | ConcertLite
      | undefined;

    const initialAttachments = parseAttachmentsJson(message.attachments);
    const replies = message.replies ?? [];
    const allAttachments: AttachmentMeta[] = [
      ...initialAttachments,
      ...replies.flatMap((r) => parseAttachmentsJson(r.attachments)),
    ];
    const urls: Record<string, string> = {};
    if (allAttachments.length > 0) {
      const paths = Array.from(new Set(allAttachments.map((a) => a.path)));
      const { $files } = await adminDb.query({
        $files: { $: { where: { path: { $in: paths } } } },
      });
      for (const f of $files as Array<{ path: string; url: string }>) {
        urls[f.path] = f.url;
      }
    }

    const initialResolved: ResolvedAttachment[] = attachWithUrls(initialAttachments, urls);
    const resolvedReplies = replies.map((r) => ({
      id: r.id,
      body: r.body,
      sender: r.sender as "customer" | "organizer",
      attachments: attachWithUrls(parseAttachmentsJson(r.attachments), urls),
      createdAt: r.createdAt,
    }));

    const response = NextResponse.json({
      thread: {
        id: message.id,
        firstName: message.firstName,
        subject: message.subject,
        body: message.body,
        status: message.status,
        language: message.language ?? null,
        createdAt: message.createdAt,
        attachments: initialResolved,
      },
      replies: resolvedReplies,
      event: concert
        ? {
            name: concert.name,
            slug: concert.slug,
            primaryColor: concert.primaryColor ?? "#1a2b4a",
          }
        : null,
    });
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err) {
    console.error("[messages/by-token GET] error:", err);
    return errorResponse(_req, "INTERNAL_ERROR", 500);
  }
}
