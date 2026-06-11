"use client";

import EventTheme from "@/components/EventTheme";
import { db } from "@/lib/db";
import { useStorageUrl } from "@/lib/useStorageUrl";
import { useLanguage } from "@/lib/LanguageContext";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const HEARTBEAT_INTERVAL = 15_000; // 15s
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
  const qty = Math.max(1, Math.min(5, Number(searchParams.get("qty")) || 1));
  const phaseId = searchParams.get("phaseId") || undefined;
  const { t } = useLanguage();

  const [queueEntryId, setQueueEntryId] = useState<string | null>(null);
  const [joining, setJoining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [heartbeatWarning, setHeartbeatWarning] = useState(false);
  const joinedRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatFailuresRef = useRef(0);
  const beatCountRef = useRef(0);

  // Polling state — updated by heartbeat responses
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [totalWaiting, setTotalWaiting] = useState(0);
  const [estimatedWaitMin, setEstimatedWaitMin] = useState(1);

  // Lightweight subscription: only ticketType + concert for display (no queueEntries)
  const { data: ticketData } = db.useQuery({
    ticketTypes: {
      $: { where: { id: ticketTypeId } },
      concert: {},
    },
  });

  const logoUrl = useStorageUrl(ticketData?.ticketTypes?.[0]?.concert?.logoPath);

  const ticketType = ticketData?.ticketTypes?.[0];
  const concert = ticketType?.concert;

  // Block draft events: redirect to event page (perm hides ticketTypes from non-organizers; this also catches organizers)
  useEffect(() => {
    if (concert && concert.slug && concert.status && concert.status !== "active") {
      router.replace(`/events/${concert.slug}`);
    }
  }, [concert, router]);

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
        setError(result.error || t("queue.joinError"));
        setJoining(false);
        return;
      }

      setQueueEntryId(result.queueEntryId);
      setQueueStatus(result.status);
      sessionStorage.setItem(
        QUEUE_ENTRY_KEY_PREFIX + ticketTypeId,
        result.queueEntryId,
      );
      setJoining(false);
    } catch {
      setError(t("queue.joinError"));
      setJoining(false);
    }
  }, [ticketTypeId, qty]);

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

  // Heartbeat — also updates position via polling
  useEffect(() => {
    if (!queueEntryId) return;

    const sendHeartbeat = async () => {
      // El estado propio (admitido?) se lee en CADA latido (barato). La posición
      // y el procesamiento de admisión solo cada 3er latido (~45s): camino "full".
      const isFull = beatCountRef.current % 3 === 0;
      beatCountRef.current++;
      try {
        const res = await fetch("/api/queue-heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queueEntryId, full: isFull }),
        });
        if (res.ok) {
          heartbeatFailuresRef.current = 0;
          setHeartbeatWarning(false);
          const data = await res.json();
          setQueueStatus(data.status);
          // En latidos baratos position/total/eta llegan null → conservar lo último.
          if (data.position !== null && data.position !== undefined) {
            setPosition(data.position);
            setTotalWaiting(data.totalWaiting);
            setEstimatedWaitMin(data.estimatedWaitMin);
          }
        } else {
          heartbeatFailuresRef.current++;
          if (heartbeatFailuresRef.current >= 3) setHeartbeatWarning(true);
        }
      } catch {
        heartbeatFailuresRef.current++;
        if (heartbeatFailuresRef.current >= 3) setHeartbeatWarning(true);
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

  // Auto-redirect when admitted or already purchasing/completed
  useEffect(() => {
    if (queueStatus === "admitted" || queueStatus === "purchasing") {
      const buyUrl = phaseId
        ? `/buy/${ticketTypeId}?qty=${qty}&phaseId=${phaseId}&queueToken=${queueEntryId}`
        : `/buy/${ticketTypeId}?qty=${qty}&queueToken=${queueEntryId}`;
      // Small delay for "admitted" so user sees the message; instant for "purchasing"
      const delay = queueStatus === "admitted" ? 1500 : 0;
      const timer = setTimeout(() => router.push(buyUrl), delay);
      return () => clearTimeout(timer);
    }
    if (queueStatus === "completed") {
      // Already bought — clear storage and go to event page
      sessionStorage.removeItem(QUEUE_ENTRY_KEY_PREFIX + ticketTypeId);
      const concertSlug = concert?.slug;
      router.push(concertSlug ? `/events/${concertSlug}` : "/");
    }
  }, [queueStatus, ticketTypeId, qty, phaseId, queueEntryId, router, concert?.slug]);

  // Handle expired entries in sessionStorage
  useEffect(() => {
    if (queueStatus === "expired") {
      sessionStorage.removeItem(QUEUE_ENTRY_KEY_PREFIX + ticketTypeId);
    }
  }, [queueStatus, ticketTypeId]);

  const handleRejoin = () => {
    sessionStorage.removeItem(QUEUE_ENTRY_KEY_PREFIX + ticketTypeId);
    joinedRef.current = false;
    setQueueEntryId(null);
    setQueueStatus(null);
    // Generate a new session so we get a fresh entry
    sessionStorage.removeItem(SESSION_KEY);
    joinQueue();
  };

  const waitingAhead = position > 0 ? position - 1 : 0;

  return (
    <EventTheme concert={concert || {}}>
    <div className="min-h-screen">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-wide">
              ma<span className="text-white/60">Tickets</span>
            </span>
            {logoUrl && (
              <>
                <span className="text-white/30">|</span>
                <img src={logoUrl} alt={concert?.name} className="h-10 w-auto object-contain" />
              </>
            )}
          </div>
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
                <p className="text-muted mt-4">{t("queue.joining")}</p>
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
                  {t("queue.tryAgain")}
                </button>
              </div>
            )}

            {/* Admitted — redirecting */}
            {queueStatus === "admitted" && (
              <div className="py-12">
                <div className="text-6xl mb-4 animate-bounce">{"\uD83C\uDF89"}</div>
                <h2 className="text-2xl font-bold text-accent-light mb-2">
                  {t("queue.yourTurn")}
                </h2>
                <p className="text-muted">{t("queue.redirectingToBuy")}</p>
                <div className="mt-4 inline-block w-8 h-8 border-4 border-accent/30 border-t-accent rounded-full animate-spin" />
              </div>
            )}

            {/* Expired */}
            {queueStatus === "expired" && (
              <div className="py-8">
                <div className="text-5xl mb-4">{"\u23F0"}</div>
                <h2 className="text-xl font-bold mb-2">{t("queue.spotExpired")}</h2>
                <p className="text-muted mb-6">
                  {t("queue.spotExpiredDesc")}
                </p>
                <button
                  onClick={handleRejoin}
                  className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
                >
                  {t("queue.rejoinQueue")}
                </button>
              </div>
            )}

            {/* Heartbeat warning */}
            {heartbeatWarning && (
              <div className="bg-warning/10 border border-warning/30 rounded-xl px-4 py-3 mb-4 text-sm text-warning font-medium">
                {t("queue.connectionIssues")}
              </div>
            )}

            {/* Waiting */}
            {queueStatus === "waiting" && !joining && (
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
                      #{position}
                    </span>
                  </div>
                </div>

                <h2 className="text-xl font-bold mb-1">{t("queue.youreInLine")}</h2>
                <p className="text-muted mb-6">
                  {waitingAhead === 0
                    ? t("queue.youreNext")
                    : t("queue.peopleAhead", { count: waitingAhead })}
                </p>

                <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto mb-6">
                  <div className="bg-background border border-border rounded-xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">
                      {t("queue.positionLabel")}
                    </p>
                    <p className="text-2xl font-bold">{position}</p>
                  </div>
                  <div className="bg-background border border-border rounded-xl p-4">
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">
                      {t("queue.waitEstLabel")}
                    </p>
                    <p className="text-2xl font-bold">
                      {t("queue.waitMinutes", { n: estimatedWaitMin })}
                    </p>
                  </div>
                </div>

                <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 max-w-sm mx-auto">
                  <p className="text-sm text-muted">
                    {t("queue.peopleInQueue", { count: totalWaiting })}
                    {" · "}
                    {t("queue.ticketsReserved", { count: qty })}
                  </p>
                  <p className="text-xs text-muted/60 mt-2">
                    {t("queue.keepTabOpen")}
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
    </EventTheme>
  );
}
