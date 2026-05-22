"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { useState, useCallback, useMemo } from "react";
import { id } from "@instantdb/react";
import BroadcastComposer from "./BroadcastComposer";
import {
  ALLOWED_IMAGE_MIME,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_IMAGE_BYTES,
  buildOrganizerReplyAttachmentPath,
  parseAttachmentsJson,
  validateImageFile,
  type AttachmentMeta,
} from "@/lib/imageUpload";

async function uploadOrganizerAttachment(path: string, file: File) {
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

type StatusFilter = "all" | "new" | "read" | "replied" | "customer-replied";
type TopTab = "messages" | "broadcasts";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  read: "bg-yellow-100 text-yellow-800",
  replied: "bg-green-100 text-green-800",
  "customer-replied": "bg-purple-100 text-purple-800",
};

const BROADCAST_STATUS_BADGE_CLASSES: Record<string, string> = {
  sending: "bg-blue-100 text-blue-800",
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const DELIVERY_STATUS_BADGE_CLASSES: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  in_flight: "bg-blue-100 text-blue-800",
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  suppressed: "bg-yellow-100 text-yellow-800",
};

const DELIVERY_STATUS_I18N_KEY: Record<string, string> = {
  pending: "admin.communications.deliveryStatusPending",
  in_flight: "admin.communications.deliveryStatusInFlight",
  sent: "admin.communications.deliveryStatusSent",
  failed: "admin.communications.deliveryStatusFailed",
  suppressed: "admin.communications.deliveryStatusSuppressed",
};

type TFunc = (key: string, params?: Record<string, string | number>) => string;

function timeAgo(ts: number, t: TFunc): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return t("admin.timeAgo.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("admin.timeAgo.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("admin.timeAgo.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  return t("admin.timeAgo.daysAgo", { n: days });
}

export default function AdminCommunicationsPage() {
  const { t } = useLanguage();
  const { user } = db.useAuth();
  const { email, isSuperAdmin } = useAuthContext();
  const refreshToken = user?.refresh_token || "";
  const [topTab, setTopTab] = useState<TopTab>("messages");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  const { isLoading, data } = db.useQuery({
    concerts: {
      $: {
        ...(isSuperAdmin ? {} : { where: { organizerEmail: email } }),
        order: { createdAt: "desc" as const },
      },
      messages: {
        $: { order: { createdAt: "desc" as const } },
        replies: {},
      },
      ticketTypes: {},
      paymentMethods: {},
      broadcasts: {
        $: { order: { createdAt: "desc" as const } },
        deliveries: {},
      },
    },
  });

  // Events the user collaborates on (separate query — see admin/page.tsx).
  const { data: collabData } = db.useQuery(
    isSuperAdmin || !email
      ? null
      : {
          eventCollaborators: {
            $: { where: { email } },
            concert: {
              messages: {
                $: { order: { createdAt: "desc" as const } },
                replies: {},
              },
              ticketTypes: {},
              paymentMethods: {},
              broadcasts: {
                $: { order: { createdAt: "desc" as const } },
                deliveries: {},
              },
            },
          },
        },
  );

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("admin.communications.loading")}</div>;
  }

  const ownedConcerts = data.concerts;
  const collabConcerts = (collabData?.eventCollaborators ?? [])
    .map((ec) => ec.concert)
    .filter((c): c is NonNullable<typeof c> => c != null);
  const seenIds = new Set<string>();
  const concerts = [...ownedConcerts, ...collabConcerts]
    .filter((c) => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  // Messages list
  const allMessages = concerts.flatMap((concert) =>
    (concert.messages || []).map((msg) => ({
      ...msg,
      concertId: concert.id,
      concertName: concert.name,
    })),
  );
  allMessages.sort(
    (a, b) =>
      ((b as { lastActivityAt?: number }).lastActivityAt ?? b.createdAt) -
      ((a as { lastActivityAt?: number }).lastActivityAt ?? a.createdAt),
  );

  const filteredMessages = allMessages.filter((msg) => {
    if (eventFilter !== "all" && msg.concertId !== eventFilter) return false;
    if (statusFilter !== "all" && msg.status !== statusFilter) return false;
    return true;
  });

  const relevantMessages = eventFilter === "all"
    ? allMessages
    : allMessages.filter((m) => m.concertId === eventFilter);
  const counts = {
    all: relevantMessages.length,
    new: relevantMessages.filter((m) => m.status === "new").length,
    read: relevantMessages.filter((m) => m.status === "read").length,
    replied: relevantMessages.filter((m) => m.status === "replied").length,
    "customer-replied": relevantMessages.filter((m) => m.status === "customer-replied").length,
  };

  // Broadcasts list
  const allBroadcasts = concerts.flatMap((concert) =>
    (concert.broadcasts || []).map((b) => ({
      ...b,
      deliveries: (b as { deliveries?: DeliveryRow[] }).deliveries ?? [],
      concertId: concert.id,
      concertName: concert.name,
      concertTicketTypes: (concert.ticketTypes ?? []).map((tt) => ({
        id: tt.id,
        name: tt.name,
      })),
      concertPaymentMethods: (concert.paymentMethods ?? []).map((pm) => ({
        id: pm.id,
        type: pm.type,
        name: pm.name,
      })),
    })),
  );
  allBroadcasts.sort((a, b) => b.createdAt - a.createdAt);

  const filteredBroadcasts = allBroadcasts.filter((b) => {
    if (eventFilter !== "all" && b.concertId !== eventFilter) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h1 className="text-3xl font-bold">{t("admin.communications.messagesTitle")}</h1>
        <button
          onClick={() => setComposerOpen(true)}
          disabled={concerts.length === 0}
          className="px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 text-sm uppercase tracking-wider"
        >
          {t("admin.broadcast.newCampaign")}
        </button>
      </div>

      {/* Event filter */}
      <div className="mb-4">
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="px-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
        >
          <option value="all">{t("admin.communications.allEvents")}</option>
          {concerts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Top tabs: Messages / Broadcasts */}
      <div className="flex gap-1 mb-4 border-b border-border">
        <button
          onClick={() => setTopTab("messages")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            topTab === "messages"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t("admin.communications.tabReceived")}
          <span className="ml-1.5 text-xs opacity-60">({allMessages.length})</span>
        </button>
        <button
          onClick={() => setTopTab("broadcasts")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            topTab === "broadcasts"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t("admin.communications.tabCampaigns")}
          <span className="ml-1.5 text-xs opacity-60">({allBroadcasts.length})</span>
        </button>
      </div>

      {topTab === "messages" && (
        <>
          {/* Status tabs */}
          <div className="flex gap-1 mb-6 border-b border-border">
            {(["all", "new", "customer-replied", "read", "replied"] as StatusFilter[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  statusFilter === tab
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab === "all"
                  ? t("admin.communications.tabAll")
                  : t(`admin.messageStatus.${tab === "customer-replied" ? "customerReplied" : tab}`)}
                <span className="ml-1.5 text-xs opacity-60">({counts[tab]})</span>
              </button>
            ))}
          </div>

          {filteredMessages.length === 0 ? (
            <p className="text-muted text-center py-12">{t("admin.communications.noMessages")}</p>
          ) : (
            <div className="space-y-3">
              {filteredMessages.map((msg) => (
                <MessageCard
                  key={msg.id}
                  message={msg}
                  expanded={expandedId === msg.id}
                  onToggle={() => setExpandedId(expandedId === msg.id ? null : msg.id)}
                  refreshToken={refreshToken}
                />
              ))}
            </div>
          )}
        </>
      )}

      {topTab === "broadcasts" && (
        <>
          {filteredBroadcasts.length === 0 ? (
            <p className="text-muted text-center py-12">
              {t("admin.communications.noBroadcasts")}
            </p>
          ) : (
            <div className="space-y-3">
              {filteredBroadcasts.map((b) => (
                <BroadcastCard
                  key={b.id}
                  broadcast={b}
                  expanded={expandedId === b.id}
                  onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
                  refreshToken={refreshToken}
                />
              ))}
            </div>
          )}
        </>
      )}

      {composerOpen && (
        <BroadcastComposer
          concerts={concerts.map((c) => ({
            id: c.id,
            name: c.name,
            ticketTypes: (c.ticketTypes ?? []).map((tt) => ({ id: tt.id, name: tt.name })),
            paymentMethods: (c.paymentMethods ?? []).map((pm) => ({
              id: pm.id,
              type: pm.type,
              name: pm.name,
            })),
          }))}
          refreshToken={refreshToken}
          onClose={() => setComposerOpen(false)}
        />
      )}
    </div>
  );
}

type MessageReplyRow = {
  id: string;
  body: string;
  sender: string;
  attachments?: string;
  createdAt: number;
};

type MessageWithConcert = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  subject: string;
  body: string;
  status: string;
  adminReply?: string;
  repliedAt?: number;
  attachments?: string;
  lastActivityAt?: number;
  replies?: MessageReplyRow[];
  createdAt: number;
  concertId: string;
  concertName: string;
};

function AttachmentThumb({ path, name, mime }: { path: string; name: string; mime: string }) {
  const { data } = db.useQuery({ $files: { $: { where: { path } } } });
  const url = data?.$files[0]?.url;
  if (!url) {
    return (
      <span className="text-xs text-muted px-2 py-1 border border-border rounded-md inline-block">
        {name}
      </span>
    );
  }
  const isHeic = mime === "image/heic" || mime === "image/heif";
  if (isHeic) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-lg border border-border bg-background px-3 py-2 text-xs hover:bg-surface"
      >
        📷 {name}
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg overflow-hidden border border-border bg-background"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={name} className="w-full h-24 object-cover" loading="lazy" />
    </a>
  );
}

function AttachmentGrid({ raw }: { raw?: string }) {
  const attachments = useMemo(() => parseAttachmentsJson(raw), [raw]);
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {attachments.map((a, idx) => (
        <AttachmentThumb key={`${a.path}-${idx}`} path={a.path} name={a.name} mime={a.mime} />
      ))}
    </div>
  );
}

function MessageCard({
  message,
  expanded,
  onToggle,
  refreshToken,
}: {
  message: MessageWithConcert;
  expanded: boolean;
  onToggle: () => void;
  refreshToken: string;
}) {
  const { t } = useLanguage();
  const badgeKey = message.status in STATUS_BADGE_CLASSES ? message.status : "new";
  const badgeClass = STATUS_BADGE_CLASSES[badgeKey];
  const badgeLabel = t(
    `admin.messageStatus.${badgeKey === "customer-replied" ? "customerReplied" : badgeKey}`,
  );
  const [revoking, setRevoking] = useState(false);

  const sortedReplies = useMemo(
    () => [...(message.replies ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [message.replies],
  );
  const lastTs = message.lastActivityAt ?? message.createdAt;

  const handleToggle = useCallback(() => {
    if (!expanded && message.status === "new") {
      db.transact(db.tx.messages[message.id].update({ status: "read" }));
    }
    onToggle();
  }, [expanded, message.id, message.status, onToggle]);

  const handleRevoke = useCallback(async () => {
    if (!confirm(t("admin.communications.revokeConfirm"))) return;
    setRevoking(true);
    try {
      await db.transact(
        db.tx.messages[message.id].merge({ accessToken: null, tokenExpiresAt: null }),
      );
    } finally {
      setRevoking(false);
    }
  }, [message.id, t]);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden transition-colors hover:border-accent/30">
      <button
        onClick={handleToggle}
        className="w-full p-5 text-left"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm">
                {message.firstName} {message.lastName}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
                {badgeLabel}
              </span>
              {sortedReplies.length > 0 && (
                <span className="text-xs text-muted">· {sortedReplies.length + 1}</span>
              )}
            </div>
            <p className="text-sm font-medium text-foreground truncate">{message.subject}</p>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted">
              <span>{message.email}</span>
              <span>&middot;</span>
              <span>{message.concertName}</span>
              <span>&middot;</span>
              <span>{timeAgo(lastTs, t)}</span>
            </div>
          </div>
          <div className="shrink-0 text-muted">
            <svg
              className={`w-5 h-5 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <p className="text-[11px] font-medium text-muted uppercase tracking-widest">
                {t("admin.communications.messageLabel")} · {message.firstName}
              </p>
              <span className="text-[11px] text-muted">{timeAgo(message.createdAt, t)}</span>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{message.body}</p>
            <AttachmentGrid raw={message.attachments} />
          </div>

          {sortedReplies.map((r) => {
            const fromOrganizer = r.sender === "organizer";
            return (
              <div
                key={r.id}
                className={`p-4 rounded-lg border ${
                  fromOrganizer
                    ? "bg-green-50 border-green-200"
                    : "bg-purple-50 border-purple-200"
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                  <p
                    className={`text-[11px] font-medium uppercase tracking-widest ${
                      fromOrganizer ? "text-green-600" : "text-purple-600"
                    }`}
                  >
                    {fromOrganizer
                      ? t("admin.communications.yourReply")
                      : t("admin.communications.customerReplyLabel")}
                  </p>
                  <span className="text-[11px] text-muted">{timeAgo(r.createdAt, t)}</span>
                </div>
                <p
                  className={`text-sm whitespace-pre-wrap leading-relaxed ${
                    fromOrganizer ? "text-green-800" : "text-purple-800"
                  }`}
                >
                  {r.body}
                </p>
                <AttachmentGrid raw={r.attachments} />
              </div>
            );
          })}

          <ReplyForm messageId={message.id} refreshToken={refreshToken} />

          <div className="pt-3 border-t border-border flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              onClick={handleRevoke}
              disabled={revoking}
              className="text-muted hover:text-red-600 underline disabled:opacity-50"
            >
              {revoking
                ? t("admin.communications.revoking")
                : t("admin.communications.revokeAccess")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyForm({ messageId, refreshToken }: { messageId: string; refreshToken: string }) {
  const { t } = useLanguage();
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const acceptAttr = useMemo(() => ALLOWED_IMAGE_MIME.join(","), []);

  const handleSelectFiles = (picked: FileList | null) => {
    if (!picked) return;
    setError("");
    const next = [...files];
    for (const f of Array.from(picked)) {
      if (next.length >= MAX_ATTACHMENTS_PER_TURN) {
        setError(t("event.attachmentTooMany"));
        break;
      }
      const err = validateImageFile(f);
      if (err === "INVALID_MIME") {
        setError(t("event.attachmentInvalid"));
        continue;
      }
      if (err === "TOO_LARGE") {
        setError(t("event.attachmentTooLarge"));
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSend = useCallback(async () => {
    if (!reply.trim()) {
      setError(t("admin.communications.replyEmpty"));
      return;
    }
    setSending(true);
    setError("");
    try {
      const replyNamespace = id();
      const uploaded: AttachmentMeta[] = [];
      for (const f of files) {
        if (f.size > MAX_IMAGE_BYTES) {
          setError(t("event.attachmentTooLarge"));
          setSending(false);
          return;
        }
        const path = buildOrganizerReplyAttachmentPath(messageId, replyNamespace, f.type, f.name);
        await uploadOrganizerAttachment(path, f);
        uploaded.push({ path, name: f.name, mime: f.type, size: f.size });
      }

      const res = await fetch("/api/reply-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ messageId, reply, attachments: uploaded }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("admin.communications.replySendFailed"));
        return;
      }
      setReply("");
      setFiles([]);
    } catch {
      setError(t("admin.broadcast.sendError"));
    } finally {
      setSending(false);
    }
  }, [reply, files, messageId, refreshToken, t]);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
          {t("admin.communications.replyLabel")}
        </label>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={5000}
          rows={3}
          className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm resize-none"
          placeholder={t("admin.communications.replyPlaceholder")}
        />
        <p className="text-right text-xs text-muted mt-1">{reply.length}/5000</p>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
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
          className="block w-full text-sm file:mr-4 file:px-3 file:py-1.5 file:rounded-md file:bg-background file:border file:border-border file:font-medium"
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
                  className="text-muted hover:text-red-500 ml-2"
                >
                  {t("event.removeAttachment")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        onClick={handleSend}
        disabled={sending || !reply.trim()}
        className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wider"
      >
        {sending
          ? files.length > 0
            ? t("event.attachmentUploading")
            : t("admin.communications.sendingReply")
          : t("admin.communications.sendReply")}
      </button>
    </div>
  );
}

type DeliveryRow = {
  id: string;
  email: string;
  emailDisplay: string;
  firstName: string;
  lastName: string;
  ticketTypeName: string;
  paymentMethod: string;
  orderStatus: string;
  language?: string;
  deliveryStatus: string;
  attempts: number;
  lastTriedAt?: number;
  sentAt?: number;
  failedAt?: number;
  reason?: string;
  createdAt: number;
};

type BroadcastWithConcert = {
  id: string;
  subject: string;
  body: string;
  filtersJson: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  status: string;
  processingState?: string;
  createdByEmail: string;
  createdAt: number;
  completedAt?: number;
  failedEmailsJson?: string;
  deliveries: DeliveryRow[];
  concertId: string;
  concertName: string;
  concertTicketTypes: { id: string; name: string }[];
  concertPaymentMethods: { id: string; type: string; name: string }[];
};

type FailedEmailEntry = { email: string; reason: string };

function parseFailedEmails(raw: string | undefined): FailedEmailEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is FailedEmailEntry =>
          typeof e?.email === "string" && typeof e?.reason === "string",
      )
      .map((e) => ({ email: e.email, reason: e.reason }));
  } catch {
    return [];
  }
}

function BroadcastCard({
  broadcast,
  expanded,
  onToggle,
  refreshToken,
}: {
  broadcast: BroadcastWithConcert;
  expanded: boolean;
  onToggle: () => void;
  refreshToken: string;
}) {
  const { t } = useLanguage();
  const badgeStatus = broadcast.status in BROADCAST_STATUS_BADGE_CLASSES ? broadcast.status : "sent";
  const badgeClass = BROADCAST_STATUS_BADGE_CLASSES[badgeStatus];
  const badgeLabel = t(`admin.broadcastStatus.${badgeStatus}`);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden transition-colors hover:border-accent/30">
      <button
        onClick={onToggle}
        className="w-full p-5 text-left"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-sm truncate">{broadcast.subject}</span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
                {badgeLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
              <span>{broadcast.concertName}</span>
              <span>&middot;</span>
              <span>
                {t("admin.communications.deliveredCount", { sent: broadcast.sentCount, total: broadcast.recipientCount })}
              </span>
              {broadcast.failedCount > 0 && (
                <>
                  <span>&middot;</span>
                  <span className="text-red-500">{t("admin.communications.failedShort", { count: broadcast.failedCount })}</span>
                </>
              )}
              <span>&middot;</span>
              <span>{timeAgo(broadcast.createdAt, t)}</span>
            </div>
          </div>
          <div className="shrink-0 text-muted">
            <svg
              className={`w-5 h-5 transition-transform ${expanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-border pt-4 space-y-4">
          <div>
            <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-1">{t("admin.communications.messageLabel")}</p>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{broadcast.body}</p>
          </div>
          <BroadcastStatsGrid broadcast={broadcast} />
          <div>
            <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-1">{t("admin.communications.sentByLabel")}</p>
            <p className="text-sm">{broadcast.createdByEmail}</p>
          </div>
          <BroadcastFiltersDisplay
            filtersJson={broadcast.filtersJson}
            ticketTypes={broadcast.concertTicketTypes}
            paymentMethods={broadcast.concertPaymentMethods}
          />
          {broadcast.deliveries.length > 0 ? (
            <RecipientsSection
              broadcastId={broadcast.id}
              deliveries={broadcast.deliveries}
              processingState={broadcast.processingState}
              refreshToken={refreshToken}
            />
          ) : (
            <LegacyFailedEmailsSection
              broadcastId={broadcast.id}
              failedEmailsJson={broadcast.failedEmailsJson}
              failedCount={broadcast.failedCount}
              recipientCount={broadcast.recipientCount}
              refreshToken={refreshToken}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BroadcastStatsGrid({ broadcast }: { broadcast: BroadcastWithConcert }) {
  const { t } = useLanguage();
  // Prefer derived counts from the deliveries list when available — that way
  // the UI reflects the latest cron tick without waiting for the broadcast
  // counter to be recomputed.
  const hasDeliveries = broadcast.deliveries.length > 0;
  const sent = hasDeliveries
    ? broadcast.deliveries.filter((d) => d.deliveryStatus === "sent").length
    : broadcast.sentCount;
  const failed = hasDeliveries
    ? broadcast.deliveries.filter((d) => d.deliveryStatus === "failed").length
    : broadcast.failedCount;
  const pending = hasDeliveries
    ? broadcast.deliveries.filter(
        (d) => d.deliveryStatus === "pending" || d.deliveryStatus === "in_flight",
      ).length
    : Math.max(0, broadcast.recipientCount - broadcast.sentCount - broadcast.failedCount);
  const suppressed = hasDeliveries
    ? broadcast.deliveries.filter((d) => d.deliveryStatus === "suppressed").length
    : broadcast.suppressedCount;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
      <div>
        <p className="text-[11px] font-medium text-muted uppercase tracking-widest">{t("admin.communications.recipientsLabel")}</p>
        <p className="font-semibold">{broadcast.recipientCount}</p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted uppercase tracking-widest">{t("admin.communications.pendingLabel")}</p>
        <p className="font-semibold text-blue-700">{pending}</p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted uppercase tracking-widest">{t("admin.communications.sentLabel")}</p>
        <p className="font-semibold text-green-700">{sent}</p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted uppercase tracking-widest">{t("admin.communications.failedLabel")}</p>
        <p className="font-semibold text-red-700">{failed}</p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted uppercase tracking-widest">{t("admin.communications.suppressedLabel")}</p>
        <p className="font-semibold text-yellow-700">{suppressed}</p>
      </div>
    </div>
  );
}

function LegacyFailedEmailsSection({
  broadcastId,
  failedEmailsJson,
  failedCount,
  recipientCount,
  refreshToken,
}: {
  broadcastId: string;
  failedEmailsJson?: string;
  failedCount: number;
  recipientCount: number;
  refreshToken: string;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retryInfo, setRetryInfo] = useState<string>("");
  const [confirmingResendAll, setConfirmingResendAll] = useState(false);
  const failed = useMemo(() => parseFailedEmails(failedEmailsJson), [failedEmailsJson]);

  if (failedCount <= 0) return null;
  // "Failed mode" = we have a per-recipient list saved, so we can retry only the
  // ones that bounced. "All mode" = legacy or list lost — resend to every
  // original recipient (some may receive twice).
  const mode: "failed" | "all" = failed.length > 0 ? "failed" : "all";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(failed.map((f) => f.email).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable; ignore
    }
  };

  const runRetry = async (resolvedMode: "failed" | "all") => {
    setRetryError("");
    setRetryInfo("");
    setRetrying(true);
    setConfirmingResendAll(false);
    try {
      const res = await fetch("/api/retry-broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ broadcastId, mode: resolvedMode }),
      });
      const data = (await res.json()) as {
        error?: string;
        newSentCount?: number;
        newFailedCount?: number;
      };
      if (!res.ok) {
        setRetryError(data.error || t("admin.communications.retryError"));
        return;
      }
      setRetryInfo(
        t("admin.communications.retryResult", {
          sent: data.newSentCount ?? 0,
          failed: data.newFailedCount ?? 0,
        }),
      );
    } catch {
      setRetryError(t("admin.communications.retryError"));
    } finally {
      setRetrying(false);
    }
  };

  const handleRetryClick = () => {
    if (mode === "all") {
      // Surface confirmation: legacy resend will reach people who already got it.
      setConfirmingResendAll(true);
      return;
    }
    runRetry("failed");
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <p className="text-[11px] font-medium text-muted uppercase tracking-widest">
          {t("admin.communications.failedEmailsTitle")}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRetryClick}
            disabled={retrying}
            className="text-xs px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent-dark transition-colors disabled:opacity-50"
          >
            {retrying
              ? t("admin.communications.retryingFailed")
              : mode === "failed"
                ? t("admin.communications.retryFailed", { count: failed.length })
                : t("admin.communications.resendAll", { count: recipientCount })}
          </button>
          {mode === "failed" && (
            <button
              type="button"
              onClick={handleCopy}
              className="text-xs px-2.5 py-1 rounded-md border border-border text-muted hover:text-foreground hover:border-accent/40 transition-colors"
            >
              {copied
                ? t("admin.communications.copyFailedEmailsDone")
                : t("admin.communications.copyFailedEmails")}
            </button>
          )}
        </div>
      </div>

      {mode === "failed" ? (
        <p className="text-xs text-muted mb-2">{t("admin.communications.failedEmailsHint")}</p>
      ) : (
        <p className="text-xs text-muted mb-2">
          {t("admin.communications.legacyFailedHint", { failed: failedCount, total: recipientCount })}
        </p>
      )}

      {confirmingResendAll && (
        <div className="mb-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-xs text-yellow-900">
          <p className="mb-2">
            {t("admin.communications.resendAllConfirm", { count: recipientCount })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runRetry("all")}
              disabled={retrying}
              className="px-2.5 py-1 rounded-md bg-yellow-800 text-white hover:bg-yellow-900 transition-colors disabled:opacity-50"
            >
              {retrying
                ? t("admin.communications.retryingFailed")
                : t("admin.communications.resendAllConfirmYes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingResendAll(false)}
              className="px-2.5 py-1 rounded-md border border-yellow-300 text-yellow-900 hover:bg-yellow-100 transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {retryInfo && <p className="text-xs text-green-700 mb-2">{retryInfo}</p>}
      {retryError && <p className="text-xs text-red-600 mb-2">{retryError}</p>}

      {mode === "failed" && (
        <div className="bg-background border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.broadcast.colEmail")}
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.communications.failedEmailReason")}
                </th>
              </tr>
            </thead>
            <tbody>
              {failed.map((f, i) => (
                <tr key={`${f.email}-${i}`} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 text-muted break-all">{f.email}</td>
                  <td className="px-3 py-2 text-muted break-all">{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type DeliveryTab = "all" | "pending" | "in_flight" | "sent" | "failed" | "suppressed";

const DELIVERY_TAB_I18N_KEY: Record<DeliveryTab, string> = {
  all: "admin.communications.deliveryTabAll",
  pending: "admin.communications.deliveryTabPending",
  in_flight: "admin.communications.deliveryTabSending",
  sent: "admin.communications.deliveryTabSent",
  failed: "admin.communications.deliveryTabFailed",
  suppressed: "admin.communications.deliveryTabSuppressed",
};

function formatLastTry(ts: number | undefined, t: TFunc): string {
  if (!ts) return "—";
  return timeAgo(ts, t);
}

function RecipientsSection({
  broadcastId,
  deliveries,
  processingState,
  refreshToken,
}: {
  broadcastId: string;
  deliveries: DeliveryRow[];
  processingState?: string;
  refreshToken: string;
}) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<DeliveryTab>("all");
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retryInfo, setRetryInfo] = useState("");
  const [checkingMissing, setCheckingMissing] = useState(false);
  const [missingError, setMissingError] = useState("");
  const [missingInfo, setMissingInfo] = useState("");

  const counts = useMemo(() => {
    const c = { all: deliveries.length, pending: 0, in_flight: 0, sent: 0, failed: 0, suppressed: 0 };
    for (const d of deliveries) {
      if (d.deliveryStatus in c) {
        c[d.deliveryStatus as Exclude<DeliveryTab, "all">] += 1;
      }
    }
    return c;
  }, [deliveries]);

  const filtered = useMemo(() => {
    const sorted = [...deliveries].sort((a, b) => {
      // Failed first, then in_flight, then pending, then sent, then suppressed.
      const order: Record<string, number> = {
        failed: 0,
        in_flight: 1,
        pending: 2,
        sent: 3,
        suppressed: 4,
      };
      const da = order[a.deliveryStatus] ?? 5;
      const db = order[b.deliveryStatus] ?? 5;
      if (da !== db) return da - db;
      return (a.email || "").localeCompare(b.email || "");
    });
    if (activeTab === "all") return sorted;
    return sorted.filter((d) => d.deliveryStatus === activeTab);
  }, [deliveries, activeTab]);

  const runRetry = useCallback(
    async (mode: "failed" | "all" | "missing") => {
      setRetryError("");
      setRetryInfo("");
      setMissingError("");
      setMissingInfo("");
      if (mode === "missing") {
        setCheckingMissing(true);
      } else {
        setRetrying(true);
      }
      try {
        const res = await fetch("/api/retry-broadcast", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${refreshToken}`,
          },
          body: JSON.stringify({ broadcastId, mode }),
        });
        const data = (await res.json()) as {
          error?: string;
          requeued?: number;
          added?: number;
        };
        if (!res.ok) {
          if (mode === "missing") {
            setMissingError(data.error || t("admin.communications.retryError"));
          } else {
            setRetryError(data.error || t("admin.communications.retryError"));
          }
          return;
        }
        if (mode === "missing") {
          if ((data.added ?? 0) === 0) {
            setMissingInfo(t("admin.communications.noNewMatches"));
          } else {
            setMissingInfo(
              t("admin.communications.newMatchesFound", { count: data.added ?? 0 }),
            );
          }
        } else {
          setRetryInfo(
            t("admin.communications.retryRequeued", { count: data.requeued ?? 0 }),
          );
        }
      } catch {
        if (mode === "missing") {
          setMissingError(t("admin.communications.retryError"));
        } else {
          setRetryError(t("admin.communications.retryError"));
        }
      } finally {
        setRetrying(false);
        setCheckingMissing(false);
      }
    },
    [broadcastId, refreshToken, t],
  );

  const isActivelySending = processingState === "queued" || processingState === "draining" || counts.in_flight > 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <p className="text-[11px] font-medium text-muted uppercase tracking-widest">
          {t("admin.communications.failedEmailsTitle")}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => runRetry("failed")}
            disabled={retrying || counts.failed === 0}
            className="text-xs px-2.5 py-1 rounded-md bg-accent text-white hover:bg-accent-dark transition-colors disabled:opacity-50"
          >
            {retrying
              ? t("admin.communications.retryingFailed")
              : t("admin.communications.retryFailedDeliveries", { count: counts.failed })}
          </button>
          <button
            type="button"
            onClick={() => runRetry("missing")}
            disabled={checkingMissing}
            className="text-xs px-2.5 py-1 rounded-md border border-border text-muted hover:text-foreground hover:border-accent/40 transition-colors disabled:opacity-50"
          >
            {checkingMissing
              ? t("admin.communications.checkingNewMatches")
              : t("admin.communications.checkNewMatches")}
          </button>
        </div>
      </div>

      {isActivelySending && (
        <p className="text-xs text-blue-600 mb-2">{t("admin.communications.sendingInBackground")}</p>
      )}
      {retryInfo && <p className="text-xs text-green-700 mb-2">{retryInfo}</p>}
      {retryError && <p className="text-xs text-red-600 mb-2">{retryError}</p>}
      {missingInfo && <p className="text-xs text-green-700 mb-2">{missingInfo}</p>}
      {missingError && <p className="text-xs text-red-600 mb-2">{missingError}</p>}

      {/* Status tabs */}
      <div className="flex gap-1 mb-3 border-b border-border overflow-x-auto">
        {(["all", "pending", "in_flight", "sent", "failed", "suppressed"] as DeliveryTab[]).map(
          (tab) => {
            const count = counts[tab as keyof typeof counts] ?? 0;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {t(DELIVERY_TAB_I18N_KEY[tab], { count })}
              </button>
            );
          },
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs text-muted py-4 text-center">
          {t("admin.communications.deliveryNoneInTab")}
        </p>
      ) : (
        <div className="bg-background border border-border rounded-lg overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.communications.deliveryColEmail")}
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.communications.deliveryColName")}
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.communications.deliveryColTicketType")}
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.communications.deliveryColStatus")}
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.communications.deliveryColReason")}
                </th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">
                  {t("admin.communications.deliveryColLastTry")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => {
                const badgeClass =
                  DELIVERY_STATUS_BADGE_CLASSES[d.deliveryStatus] ??
                  "bg-gray-100 text-gray-700";
                const badgeLabel = t(
                  DELIVERY_STATUS_I18N_KEY[d.deliveryStatus] ??
                    "admin.communications.deliveryStatusPending",
                );
                const lastTry = d.lastTriedAt ?? d.sentAt ?? d.failedAt;
                const fullName = [d.firstName, d.lastName].filter(Boolean).join(" ");
                return (
                  <tr key={d.id} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 text-muted break-all">{d.emailDisplay || d.email}</td>
                    <td className="px-3 py-2 text-muted">{fullName || "—"}</td>
                    <td className="px-3 py-2 text-muted">{d.ticketTypeName || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
                        {badgeLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted break-all">{d.reason || "—"}</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">
                      {formatLastTry(lastTry, t)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PAYMENT_METHOD_TYPE_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  zelle: "Zelle",
  pago_movil: "Pago Móvil",
};

function BroadcastFiltersDisplay({
  filtersJson,
  ticketTypes,
  paymentMethods,
}: {
  filtersJson?: string;
  ticketTypes: { id: string; name: string }[];
  paymentMethods: { id: string; type: string; name: string }[];
}) {
  const { t } = useLanguage();

  const filters = useMemo(() => {
    if (!filtersJson) return null;
    try {
      const parsed = JSON.parse(filtersJson);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        orderStatuses: Array.isArray(parsed.orderStatuses) ? (parsed.orderStatuses as string[]) : [],
        ticketTypeIds: Array.isArray(parsed.ticketTypeIds) ? (parsed.ticketTypeIds as string[]) : [],
        paymentMethodTypes: Array.isArray(parsed.paymentMethodTypes)
          ? (parsed.paymentMethodTypes as string[])
          : [],
      };
    } catch {
      return null;
    }
  }, [filtersJson]);

  if (!filters) return null;

  const statusLabels = filters.orderStatuses.map((s) => t(`common.${s}`));

  const ticketTypeLabels = filters.ticketTypeIds.map(
    (id) => ticketTypes.find((tt) => tt.id === id)?.name ?? id,
  );

  const paymentMethodLabels = filters.paymentMethodTypes.map((type) => {
    const baseLabel = PAYMENT_METHOD_TYPE_LABELS[type];
    if (baseLabel) return baseLabel;
    const match = paymentMethods.find((pm) => pm.type === type);
    return match?.name ?? type;
  });

  if (
    statusLabels.length === 0 &&
    ticketTypeLabels.length === 0 &&
    paymentMethodLabels.length === 0
  ) {
    return null;
  }

  return (
    <div>
      <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
        {t("admin.communications.filtersLabel")}
      </p>
      <div className="space-y-1.5 text-sm">
        {statusLabels.length > 0 && (
          <FilterRow
            label={t("admin.communications.filtersOrderStatus")}
            chips={statusLabels}
          />
        )}
        {ticketTypeLabels.length > 0 && (
          <FilterRow
            label={t("admin.communications.filtersTicketTypes")}
            chips={ticketTypeLabels}
          />
        )}
        {paymentMethodLabels.length > 0 && (
          <FilterRow
            label={t("admin.communications.filtersPaymentMethods")}
            chips={paymentMethodLabels}
          />
        )}
      </div>
    </div>
  );
}

function FilterRow({ label, chips }: { label: string; chips: string[] }) {
  return (
    <div className="flex gap-2 items-baseline flex-wrap">
      <span className="text-xs text-muted shrink-0 sm:min-w-[140px]">{label}:</span>
      <div className="flex gap-1.5 flex-wrap">
        {chips.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-background border border-border"
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}
