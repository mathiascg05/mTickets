"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useState, useCallback } from "react";
import BroadcastComposer from "./BroadcastComposer";

type StatusFilter = "all" | "new" | "read" | "replied";
type TopTab = "messages" | "broadcasts";

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  new: { label: "New", className: "bg-blue-100 text-blue-800" },
  read: { label: "Read", className: "bg-yellow-100 text-yellow-800" },
  replied: { label: "Replied", className: "bg-green-100 text-green-800" },
};

const BROADCAST_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  sending: { label: "Enviando", className: "bg-blue-100 text-blue-800" },
  sent: { label: "Enviada", className: "bg-green-100 text-green-800" },
  failed: { label: "Fallida", className: "bg-red-100 text-red-800" },
};

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminCommunicationsPage() {
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
      messages: { $: { order: { createdAt: "desc" as const } } },
      ticketTypes: {},
      paymentMethods: {},
      broadcasts: { $: { order: { createdAt: "desc" as const } } },
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
              messages: { $: { order: { createdAt: "desc" as const } } },
              ticketTypes: {},
              paymentMethods: {},
              broadcasts: { $: { order: { createdAt: "desc" as const } } },
            },
          },
        },
  );

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">Loading...</div>;
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
  allMessages.sort((a, b) => b.createdAt - a.createdAt);

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
  };

  // Broadcasts list
  const allBroadcasts = concerts.flatMap((concert) =>
    (concert.broadcasts || []).map((b) => ({
      ...b,
      concertId: concert.id,
      concertName: concert.name,
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
        <h1 className="text-3xl font-bold">Messages</h1>
        <button
          onClick={() => setComposerOpen(true)}
          disabled={concerts.length === 0}
          className="px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 text-sm uppercase tracking-wider"
        >
          Nueva campaña
        </button>
      </div>

      {/* Event filter */}
      <div className="mb-4">
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="px-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
        >
          <option value="all">All Events</option>
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
          Recibidos
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
          Campañas
          <span className="ml-1.5 text-xs opacity-60">({allBroadcasts.length})</span>
        </button>
      </div>

      {topTab === "messages" && (
        <>
          {/* Status tabs */}
          <div className="flex gap-1 mb-6 border-b border-border">
            {(["all", "new", "read", "replied"] as StatusFilter[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
                  statusFilter === tab
                    ? "border-accent text-accent"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                <span className="ml-1.5 text-xs opacity-60">({counts[tab]})</span>
              </button>
            ))}
          </div>

          {filteredMessages.length === 0 ? (
            <p className="text-muted text-center py-12">No messages found.</p>
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
              No has enviado campañas todavía. Haz clic en &ldquo;Nueva campaña&rdquo; para empezar.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredBroadcasts.map((b) => (
                <BroadcastCard
                  key={b.id}
                  broadcast={b}
                  expanded={expandedId === b.id}
                  onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
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
  createdAt: number;
  concertId: string;
  concertName: string;
};

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
  const badge = STATUS_BADGES[message.status] ?? STATUS_BADGES.new;

  // Mark as read when expanding a "new" message
  const handleToggle = useCallback(() => {
    if (!expanded && message.status === "new") {
      db.transact(db.tx.messages[message.id].update({ status: "read" }));
    }
    onToggle();
  }, [expanded, message.id, message.status, onToggle]);

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
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <p className="text-sm font-medium text-foreground truncate">{message.subject}</p>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted">
              <span>{message.email}</span>
              <span>&middot;</span>
              <span>{message.concertName}</span>
              <span>&middot;</span>
              <span>{timeAgo(message.createdAt)}</span>
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
            <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-1">Message</p>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{message.body}</p>
          </div>

          {message.status === "replied" && message.adminReply && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-[11px] font-medium text-green-600 uppercase tracking-widest mb-1">Your Reply</p>
              <p className="text-sm text-green-800 whitespace-pre-wrap leading-relaxed">{message.adminReply}</p>
              {message.repliedAt && (
                <p className="text-xs text-green-600 mt-2">Replied {timeAgo(message.repliedAt)}</p>
              )}
            </div>
          )}

          {message.status !== "replied" && (
            <ReplyForm messageId={message.id} refreshToken={refreshToken} />
          )}
        </div>
      )}
    </div>
  );
}

function ReplyForm({ messageId, refreshToken }: { messageId: string; refreshToken: string }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleSend = useCallback(async () => {
    if (!reply.trim()) {
      setError("Reply cannot be empty.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/reply-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ messageId, reply }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send reply.");
        return;
      }
      setReply("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }, [reply, messageId, refreshToken]);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
          Reply
        </label>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={5000}
          rows={3}
          className="w-full px-4 py-2.5 bg-background border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm resize-none"
          placeholder="Type your reply..."
        />
        <p className="text-right text-xs text-muted mt-1">{reply.length}/5000</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        onClick={handleSend}
        disabled={sending || !reply.trim()}
        className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm uppercase tracking-wider"
      >
        {sending ? "Sending..." : "Send Reply"}
      </button>
    </div>
  );
}

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
  createdByEmail: string;
  createdAt: number;
  completedAt?: number;
  concertId: string;
  concertName: string;
};

function BroadcastCard({
  broadcast,
  expanded,
  onToggle,
}: {
  broadcast: BroadcastWithConcert;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badge = BROADCAST_STATUS_BADGES[broadcast.status] ?? BROADCAST_STATUS_BADGES.sent;

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
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
              <span>{broadcast.concertName}</span>
              <span>&middot;</span>
              <span>
                {broadcast.sentCount}/{broadcast.recipientCount} entregados
              </span>
              {broadcast.failedCount > 0 && (
                <>
                  <span>&middot;</span>
                  <span className="text-red-500">{broadcast.failedCount} fallidos</span>
                </>
              )}
              <span>&middot;</span>
              <span>{timeAgo(broadcast.createdAt)}</span>
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
            <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-1">Mensaje</p>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{broadcast.body}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[11px] font-medium text-muted uppercase tracking-widest">Destinatarios</p>
              <p className="font-semibold">{broadcast.recipientCount}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted uppercase tracking-widest">Enviados</p>
              <p className="font-semibold text-green-700">{broadcast.sentCount}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted uppercase tracking-widest">Fallidos</p>
              <p className="font-semibold text-red-700">{broadcast.failedCount}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted uppercase tracking-widest">Suprimidos</p>
              <p className="font-semibold text-yellow-700">{broadcast.suppressedCount}</p>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-1">Enviado por</p>
            <p className="text-sm">{broadcast.createdByEmail}</p>
          </div>
        </div>
      )}
    </div>
  );
}
