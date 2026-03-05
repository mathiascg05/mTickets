"use client";

import { db } from "@/lib/db";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const HEARTBEAT_INTERVAL = 60_000; // 60s
const SESSION_KEY = "queue_session_id";
const QUEUE_ENTRY_KEY_PREFIX = "queue_entry_";

function getOrCreateSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

export default function QueuePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketTypeId = params.ticketTypeId as string;
  const qty = Math.max(1, Math.min(10, Number(searchParams.get("qty")) || 1));
  const phaseId = searchParams.get("phaseId") || undefined;

  const [queueEntryId, setQueueEntryId] = useState<string | null>(null);
  const [joining, setJoining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const joinedRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Query ticketType info for display
  const { data: ticketData } = db.useQuery({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      concert: {},
    },
  });

  const ticketType = ticketData?.ticketTypes?.[0];
  const concert = ticketType?.concert;

  // Subscribe to this queue entry for real-time status updates
  const { data: entryData } = db.useQuery(
    queueEntryId
      ? { queueEntries: { $: { where: { id: queueEntryId } } } }
      : null,
  );

  // Subscribe to all active entries for this ticketType to compute position
  const { data: allEntriesData } = db.useQuery({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      queueEntries: {},
    },
  });

  const currentEntry = entryData?.queueEntries?.[0];
  const allEntries = allEntriesData?.ticketTypes?.[0]?.queueEntries || [];

  // Compute live position
  const waitingAhead =
    currentEntry?.status === "waiting"
      ? allEntries.filter(
          (e) =>
            e.status === "waiting" &&
            e.expiresAt > Date.now() &&
            e.position < (currentEntry?.position ?? Infinity),
        ).length
      : 0;

  const totalWaiting = allEntries.filter(
    (e) => e.status === "waiting" && e.expiresAt > Date.now(),
  ).length;

  // Estimated wait: ~30s per person ahead (average admission cycle)
  const estimatedWaitSec = waitingAhead * 30;
  const estimatedWaitMin = Math.max(1, Math.ceil(estimatedWaitSec / 60));

  // Join queue on mount
  const joinQueue = useCallback(async () => {
    try {
      setJoining(true);
      setError(null);
      const sessionId = getOrCreateSessionId();

      const res = await fetch("/api/join-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketTypeId, qty, sessionId }),
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error || "Failed to join queue");
        setJoining(false);
        return;
      }

      setQueueEntryId(result.queueEntryId);
      sessionStorage.setItem(
        QUEUE_ENTRY_KEY_PREFIX + ticketTypeId,
        result.queueEntryId,
      );
      setJoining(false);
    } catch {
      setError("Failed to join queue. Please try again.");
      setJoining(false);
    }
  }, [ticketTypeId, qty]);

  // Validate stored entry belongs to current ticketType once allEntriesData loads
  const validatedRef = useRef(false);
  useEffect(() => {
    if (!queueEntryId || validatedRef.current) return;
    if (!allEntriesData?.ticketTypes?.[0]) return;
    validatedRef.current = true;

    const belongsToThisTicketType = allEntries.some(
      (e) => e.id === queueEntryId,
    );
    if (!belongsToThisTicketType) {
      // Stored entry is for a different ticketType — clear and rejoin
      sessionStorage.removeItem(QUEUE_ENTRY_KEY_PREFIX + ticketTypeId);
      setQueueEntryId(null);
      joinedRef.current = false;
      joinQueue();
    }
  }, [queueEntryId, allEntriesData, allEntries, ticketTypeId, joinQueue]);

  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;

    // Check for existing queue entry in sessionStorage
    const storedEntryId = sessionStorage.getItem(
      QUEUE_ENTRY_KEY_PREFIX + ticketTypeId,
    );
    if (storedEntryId) {
      setQueueEntryId(storedEntryId);
      setJoining(false);
    } else {
      joinQueue();
    }
  }, [ticketTypeId, joinQueue]);

  // Heartbeat
  useEffect(() => {
    if (!queueEntryId) return;

    const sendHeartbeat = async () => {
      try {
        await fetch("/api/queue-heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queueEntryId }),
        });
      } catch {
        // Heartbeat failure is non-fatal
      }
    };

    // Send first heartbeat right away
    sendHeartbeat();

    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [queueEntryId]);

  // Auto-redirect when admitted
  useEffect(() => {
    if (currentEntry?.status === "admitted") {
      const buyUrl = phaseId
        ? `/buy/${ticketTypeId}?qty=${qty}&phaseId=${phaseId}&queueToken=${queueEntryId}`
        : `/buy/${ticketTypeId}?qty=${qty}&queueToken=${queueEntryId}`;
      // Small delay so user sees the "It's your turn!" message
      const timer = setTimeout(() => router.push(buyUrl), 1500);
      return () => clearTimeout(timer);
    }
  }, [currentEntry?.status, ticketTypeId, qty, phaseId, queueEntryId, router]);

  // Handle expired/completed entries in sessionStorage
  useEffect(() => {
    if (
      currentEntry?.status === "expired" ||
      currentEntry?.status === "completed"
    ) {
      sessionStorage.removeItem(QUEUE_ENTRY_KEY_PREFIX + ticketTypeId);
    }
  }, [currentEntry?.status, ticketTypeId]);

  const handleRejoin = () => {
    sessionStorage.removeItem(QUEUE_ENTRY_KEY_PREFIX + ticketTypeId);
    joinedRef.current = false;
    setQueueEntryId(null);
    // Generate a new session so we get a fresh entry
    sessionStorage.removeItem(SESSION_KEY);
    joinQueue();
  };

  return (
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4">
          <span className="text-xl font-bold tracking-wide">
            ma<span className="text-white/60">Tickets</span>
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-lg">
          {/* Header gradient */}
          <div className="h-32 bg-gradient-to-br from-accent-dark via-accent to-accent-light flex items-center justify-center">
            <span className="text-5xl opacity-30">{"\u23F3"}</span>
          </div>

          <div className="p-6 sm:p-8 text-center">
            {concert && (
              <p className="text-sm text-muted mb-1">{concert.name}</p>
            )}
            {ticketType && (
              <h1 className="text-2xl font-bold mb-6">{ticketType.name}</h1>
            )}

            {/* Loading state */}
            {joining && (
              <div className="py-12">
                <div className="inline-block w-10 h-10 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
                <p className="text-muted mt-4">Joining queue...</p>
              </div>
            )}

            {/* Error state */}
            {error && !joining && (
              <div className="py-8">
                <div className="text-5xl mb-4">{"\u26A0\uFE0F"}</div>
                <p className="text-danger mb-4">{error}</p>
                <button
                  onClick={handleRejoin}
                  className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Admitted — redirecting */}
            {currentEntry?.status === "admitted" && (
              <div className="py-12">
                <div className="text-6xl mb-4 animate-bounce">{"\uD83C\uDF89"}</div>
                <h2 className="text-2xl font-bold text-accent-light mb-2">
                  It&apos;s your turn!
                </h2>
                <p className="text-muted">Redirecting you to the buy page...</p>
                <div className="mt-4 inline-block w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
              </div>
            )}

            {/* Expired */}
            {currentEntry?.status === "expired" && (
              <div className="py-8">
                <div className="text-5xl mb-4">{"\u23F0"}</div>
                <h2 className="text-xl font-bold mb-2">Your spot expired</h2>
                <p className="text-muted mb-6">
                  Your place in the queue has expired. You can rejoin to get a
                  new spot.
                </p>
                <button
                  onClick={handleRejoin}
                  className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
                >
                  Rejoin Queue
                </button>
              </div>
            )}

            {/* Waiting */}
            {currentEntry?.status === "waiting" && !joining && (
              <div className="py-8">
                {/* Animated progress ring */}
                <div className="relative inline-flex items-center justify-center mb-6">
                  <svg
                    className="w-32 h-32 animate-spin-slow"
                    viewBox="0 0 120 120"
                  >
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      className="text-border"
                    />
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="6"
                      strokeDasharray="80 234"
                      strokeLinecap="round"
                      className="text-accent-light"
                    />
                  </svg>
                  <div className="absolute">
                    <span className="text-3xl font-bold text-accent-light">
                      #{waitingAhead + 1}
                    </span>
                  </div>
                </div>

                <h2 className="text-xl font-bold mb-1">You&apos;re in line</h2>
                <p className="text-muted mb-6">
                  {waitingAhead === 0
                    ? "You're next! Hang tight..."
                    : `${waitingAhead} ${waitingAhead === 1 ? "person" : "people"} ahead of you`}
                </p>

                <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto mb-6">
                  <div className="bg-background border border-border rounded-xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">
                      Position
                    </p>
                    <p className="text-2xl font-bold">{waitingAhead + 1}</p>
                  </div>
                  <div className="bg-background border border-border rounded-xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">
                      Est. Wait
                    </p>
                    <p className="text-2xl font-bold">
                      ~{estimatedWaitMin}m
                    </p>
                  </div>
                </div>

                <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 max-w-sm mx-auto">
                  <p className="text-sm text-muted">
                    {totalWaiting} {totalWaiting === 1 ? "person" : "people"}{" "}
                    in queue &middot; {qty} ticket{qty !== 1 ? "s" : ""}{" "}
                    reserved
                  </p>
                  <p className="text-xs text-muted/60 mt-2">
                    Keep this tab open. You&apos;ll be redirected automatically
                    when it&apos;s your turn.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes spin-slow {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .animate-spin-slow {
          animation: spin-slow 8s linear infinite;
        }
      `}</style>
    </div>
  );
}
