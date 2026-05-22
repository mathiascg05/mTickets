"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { id } from "@instantdb/react";
import { db } from "@/lib/db";
import { useLanguage } from "@/lib/LanguageContext";
import {
  ALLOWED_IMAGE_MIME,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_IMAGE_BYTES,
  buildCustomerReplyAttachmentPath,
  validateImageFile,
  type AttachmentMeta,
} from "@/lib/imageUpload";

type ResolvedAttachment = AttachmentMeta & { url: string };

type ThreadResponse = {
  thread: {
    id: string;
    firstName: string;
    subject: string;
    body: string;
    status: string;
    language: string | null;
    createdAt: number;
    attachments: ResolvedAttachment[];
  };
  replies: Array<{
    id: string;
    body: string;
    sender: "customer" | "organizer";
    attachments: ResolvedAttachment[];
    createdAt: number;
  }>;
  event: { name: string; slug: string; primaryColor: string } | null;
};

async function uploadWithRetry(path: string, file: File) {
  try {
    await db.storage.upload(path, file);
  } catch (err) {
    const isIdbClosing =
      err instanceof Error &&
      err.name === "InvalidStateError" &&
      err.message.includes("IDBDatabase");
    if (!isIdbClosing) throw err;
    await new Promise((r) => setTimeout(r, 500));
    await db.storage.upload(path, file);
  }
}

function formatRelative(ts: number, locale: string): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return locale === "es" ? "ahora" : "now";
  if (minutes < 60) return locale === "es" ? `hace ${minutes} min` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return locale === "es" ? `hace ${hours} h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return locale === "es" ? `hace ${days} d` : `${days}d ago`;
  return new Date(ts).toLocaleDateString(locale);
}

export default function MessageThreadClient({
  token,
  locale,
}: {
  token: string;
  locale: string;
}) {
  const { t } = useLanguage();
  const [data, setData] = useState<ThreadResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const acceptAttr = useMemo(() => ALLOWED_IMAGE_MIME.join(","), []);

  const fetchThread = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/by-token/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json.code || json.error || "TOKEN_INVALID");
        return;
      }
      setData(json as ThreadResponse);
    } catch (err) {
      setLoadError(String(err));
    }
  }, [token]);

  useEffect(() => {
    void fetchThread();
  }, [fetchThread]);

  function handleSelectFiles(picked: FileList | null) {
    if (!picked) return;
    setSubmitError(null);
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (next.length >= MAX_ATTACHMENTS_PER_TURN) {
        setSubmitError(t("event.attachmentTooMany"));
        break;
      }
      const err = validateImageFile(f);
      if (err === "INVALID_MIME") {
        setSubmitError(t("event.attachmentInvalid"));
        continue;
      }
      if (err === "TOO_LARGE") {
        setSubmitError(t("event.attachmentTooLarge"));
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !data) return;
    setSubmitError(null);

    if (replyBody.trim().length === 0) {
      setSubmitError(t("event.allFieldsRequired"));
      return;
    }
    if (files.length > MAX_ATTACHMENTS_PER_TURN) {
      setSubmitError(t("event.attachmentTooMany"));
      return;
    }

    setSubmitting(true);
    try {
      const messageId = data.thread.id;
      const replyNamespace = id();
      const uploaded: AttachmentMeta[] = [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_BYTES) {
          setSubmitError(t("event.attachmentTooLarge"));
          setSubmitting(false);
          return;
        }
        const path = buildCustomerReplyAttachmentPath(messageId, replyNamespace, f.type, f.name);
        await uploadWithRetry(path, f);
        uploaded.push({ path, name: f.name, mime: f.type, size: f.size });
      }

      const res = await fetch(`/api/messages/by-token/${encodeURIComponent(token)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody.trim(), attachments: uploaded }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(json.error || json.code || "Error");
        return;
      }

      setReplyBody("");
      setFiles([]);
      setSuccess(true);
      await fetchThread();
    } catch (err) {
      setSubmitError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    const errLabel =
      loadError === "TOKEN_EXPIRED"
        ? t("apiErrors.TOKEN_EXPIRED")
        : loadError === "TOKEN_REVOKED"
          ? t("apiErrors.TOKEN_REVOKED")
          : t("apiErrors.TOKEN_INVALID");
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 max-w-md w-full text-center">
          <p className="text-danger font-semibold">{errLabel}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        {t("common.loading")}
      </div>
    );
  }

  const primary = data.event?.primaryColor ?? "#1a2b4a";
  const items: Array<
    | {
        kind: "initial";
        sender: "customer";
        body: string;
        attachments: ResolvedAttachment[];
        createdAt: number;
        firstName: string;
      }
    | {
        kind: "reply";
        sender: "customer" | "organizer";
        body: string;
        attachments: ResolvedAttachment[];
        createdAt: number;
      }
  > = [
    {
      kind: "initial",
      sender: "customer",
      body: data.thread.body,
      attachments: data.thread.attachments,
      createdAt: data.thread.createdAt,
      firstName: data.thread.firstName,
    },
    ...data.replies.map((r) => ({
      kind: "reply" as const,
      sender: r.sender,
      body: r.body,
      attachments: r.attachments,
      createdAt: r.createdAt,
    })),
  ];

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="bg-surface border border-border rounded-2xl p-5 sm:p-6">
          {data.event && (
            <p className="text-xs uppercase tracking-wider" style={{ color: primary }}>
              {data.event.name}
            </p>
          )}
          <h1 className="text-xl sm:text-2xl font-bold mt-1">{data.thread.subject}</h1>
        </div>

        <div className="space-y-4">
          {items.map((item, i) => (
            <ThreadBubble
              key={i}
              sender={item.sender}
              body={item.body}
              attachments={item.attachments}
              createdAt={item.createdAt}
              locale={locale}
              primary={primary}
              t={t}
            />
          ))}
        </div>

        <form
          onSubmit={submit}
          className="bg-surface border border-border rounded-2xl p-5 sm:p-6 space-y-3"
        >
          <p className="text-sm font-semibold">{t("event.sendMessage")}</p>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder={t("event.messagePlaceholder")}
            rows={5}
            maxLength={5000}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm resize-y"
          />

          <div>
            <label className="block text-xs font-medium text-muted uppercase mb-1.5">
              {t("event.attachImages")}
            </label>
            <input
              type="file"
              accept={acceptAttr}
              multiple
              onChange={(e) => {
                handleSelectFiles(e.target.files);
                e.currentTarget.value = "";
              }}
              className="block w-full text-sm file:mr-4 file:px-3 file:py-1.5 file:rounded-lg file:bg-background file:border file:border-border file:font-medium"
            />
            <p className="text-xs text-muted mt-1">{t("event.attachHint")}</p>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, idx) => (
                  <li
                    key={`${f.name}-${idx}`}
                    className="flex items-center justify-between text-xs bg-background border border-border rounded-md px-2 py-1"
                  >
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-muted hover:text-danger ml-2"
                    >
                      {t("event.removeAttachment")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {submitError && <p className="text-sm text-danger">{submitError}</p>}
          {success && !submitError && (
            <p className="text-sm" style={{ color: primary }}>
              {t("event.messageSent")}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{ background: primary }}
            className="w-full py-2.5 text-white rounded-xl font-semibold disabled:opacity-50"
          >
            {submitting ? t("event.attachmentUploading") : t("event.sendMessage")}
          </button>
        </form>
      </div>
    </div>
  );
}

function ThreadBubble({
  sender,
  body,
  attachments,
  createdAt,
  locale,
  primary,
  t,
}: {
  sender: "customer" | "organizer";
  body: string;
  attachments: ResolvedAttachment[];
  createdAt: number;
  locale: string;
  primary: string;
  t: (k: string) => string;
}) {
  const isOrganizer = sender === "organizer";
  return (
    <div className={`flex ${isOrganizer ? "justify-start" : "justify-end"}`}>
      <div
        className="max-w-[85%] rounded-2xl px-4 py-3 border"
        style={
          isOrganizer
            ? { borderColor: `${primary}30`, background: `${primary}10` }
            : { borderColor: "var(--color-border)", background: "var(--color-surface)" }
        }
      >
        <p className="text-xs uppercase tracking-wider text-muted mb-1">
          {isOrganizer ? t("event.contactOrganizer") : t("event.message")}
        </p>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{body}</p>
        {attachments.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            {attachments.map((a, idx) => (
              <AttachmentThumb key={`${a.path}-${idx}`} attachment={a} />
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted mt-2">{formatRelative(createdAt, locale)}</p>
      </div>
    </div>
  );
}

function AttachmentThumb({ attachment }: { attachment: ResolvedAttachment }) {
  const isHeic =
    attachment.mime === "image/heic" || attachment.mime === "image/heif";
  if (isHeic) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-lg border border-border bg-background px-3 py-2 text-xs hover:bg-surface"
      >
        <span className="block truncate">📷 {attachment.name}</span>
      </a>
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg overflow-hidden border border-border bg-background"
    >
      <img
        src={attachment.url}
        alt={attachment.name}
        className="w-full h-32 object-cover"
        loading="lazy"
      />
    </a>
  );
}
