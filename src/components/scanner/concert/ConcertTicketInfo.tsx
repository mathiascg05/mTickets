"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { useEffect, useState } from "react";
import { playFeedback } from "../feedback";

type ValidatedOrder = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cedula: string;
  status: string;
  visited: boolean;
  orderNumber?: string | null;
  ticketTypeName?: string | null;
  concertId: string;
  concertName: string;
};

export function ConcertTicketInfo({
  orderId,
  onReset,
  scannerToken,
  scopedConcertId,
  onMarked,
}: {
  orderId: string;
  onReset: () => void;
  scannerToken: string;
  scopedConcertId: string;
  onMarked?: () => void;
}) {
  const { t } = useLanguage();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markSuccess, setMarkSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<ValidatedOrder | null>(null);
  const [wrongEvent, setWrongEvent] = useState(false);
  const [wrongEventName, setWrongEventName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Read-only validate via the scanner-token route (orders aren't client-
  // readable). Marking still goes through /api/mark-visited.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/scan/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${scannerToken}`,
          },
          body: JSON.stringify({ orderId }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.found) {
          setNotFound(true);
        } else if (json.wrongEvent) {
          setWrongEvent(true);
          setWrongEventName(json.concertName ?? null);
        } else {
          setOrder(json.order as ValidatedOrder);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderId, scannerToken]);

  if (loading) {
    return (
      <div className="animate-pulse text-muted">{t("scan.lookingUp")}</div>
    );
  }

  if (notFound || (!order && !wrongEvent)) {
    return (
      <div className="bg-danger/10 border border-danger/30 rounded-xl p-6 text-center">
        <p className="text-danger font-semibold text-lg">
          {t("scan.ticketNotFound")}
        </p>
        <p className="text-muted text-sm mt-2">
          {t("scan.ticketNotFoundDesc")}
        </p>
        <button
          onClick={onReset}
          className="mt-4 px-6 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
        >
          {t("scan.scanAgain")}
        </button>
      </div>
    );
  }

  const isWrongEvent = wrongEvent || (!!order && order.concertId !== scopedConcertId);
  const ticketType = order ? { name: order.ticketTypeName ?? "" } : null;
  const concert = { name: order?.concertName ?? wrongEventName ?? "" };

  async function markVisited() {
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch("/api/mark-visited", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, scannerToken }),
      });
      if (!res.ok) {
        let msg = t("scan.markFailed");
        try {
          const body = await res.json();
          msg = body.error || msg;
        } catch {}
        setMarkError(msg);
        playFeedback("error");
        return;
      }
      setMarkSuccess(true);
      playFeedback("success");
      onMarked?.();
    } catch {
      setMarkError(t("scan.offline"));
      playFeedback("error");
    } finally {
      setMarking(false);
    }
  }

  // Wrong-event scan: we deliberately don't have the other event's PII, so show
  // only the warning (no details grid) and let the operator scan again.
  if (!order) {
    return (
      <div className="space-y-4">
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">{t("scan.wrongEvent")}</p>
          <p className="text-sm text-muted mt-1">
            {t("scan.wrongEventDescBefore")}
            <strong>{concert.name || t("scan.anotherEvent")}</strong>
            {t("scan.wrongEventDescAfter")}
          </p>
        </div>
        <button
          onClick={onReset}
          className="w-full py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-semibold transition-colors"
        >
          {t("scan.scanAgain")}
        </button>
      </div>
    );
  }

  const isApproved = order.status === "approved";
  const isVisited = order.visited;
  const showMarkButton =
    isApproved && !isVisited && !isWrongEvent && !markSuccess;
  const scanAgainPrimary = !showMarkButton;

  return (
    <div className="space-y-4">
      {isWrongEvent && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">{t("scan.wrongEvent")}</p>
          <p className="text-sm text-muted mt-1">
            {t("scan.wrongEventDescBefore")}
            <strong>{concert?.name || t("scan.anotherEvent")}</strong>
            {t("scan.wrongEventDescAfter")}
          </p>
        </div>
      )}

      {!isApproved && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-center">
          <p className="text-danger font-semibold">{t("scan.notApproved")}</p>
          <p className="text-sm text-muted mt-1">
            {t("scan.notApprovedDescBefore")}
            <strong>{order.status}</strong>
          </p>
        </div>
      )}

      {isVisited && !markSuccess && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 text-center">
          <p className="text-warning font-semibold">
            {t("scan.alreadyScanned")}
          </p>
          <p className="text-sm text-muted mt-1">
            {t("scan.alreadyScannedDesc")}
          </p>
        </div>
      )}

      {markError && (
        <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-center">
          <p className="text-danger font-semibold text-sm">{markError}</p>
        </div>
      )}

      {markSuccess && (
        <div className="bg-success/10 border border-success/30 rounded-xl p-4 text-center">
          <p className="text-success font-semibold">{t("scan.entrySuccess")}</p>
          <p className="text-sm text-muted mt-1">
            {order.firstName} {order.lastName} ·{" "}
            {ticketType?.name || t("scan.ticketFallback")}
          </p>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="text-center mb-4">
          {(isApproved && !isVisited && !isWrongEvent) || markSuccess ? (
            <div className="text-5xl mb-2 text-success">{"✓"}</div>
          ) : null}
          {order.orderNumber && (
            <p className="text-sm font-mono font-bold text-accent-light tracking-wide mb-1">
              {order.orderNumber}
            </p>
          )}
          <h3 className="text-xl font-bold">
            {concert?.name || t("scan.eventFallback")}
          </h3>
          <p className="text-muted">
            {ticketType?.name || t("scan.ticketFallback")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm border-t border-border pt-4">
          <div>
            <p className="text-muted">{t("scan.fieldName")}</p>
            <p className="font-medium">
              {order.firstName} {order.lastName}
            </p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldEmail")}</p>
            <p className="font-medium">{order.email}</p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldCedula")}</p>
            <p className="font-medium">{order.cedula}</p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldStatus")}</p>
            <p
              className={`font-medium ${isApproved ? "text-success" : "text-danger"}`}
            >
              {order.status}
            </p>
          </div>
          <div>
            <p className="text-muted">{t("scan.fieldVisited")}</p>
            <p className="font-medium">
              {isVisited || markSuccess ? t("scan.yes") : t("scan.no")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        {showMarkButton && (
          <button
            onClick={markVisited}
            disabled={marking}
            className="flex-1 py-3 bg-success hover:bg-success/80 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
          >
            {marking ? t("scan.marking") : t("scan.markVisited")}
          </button>
        )}
        <button
          onClick={onReset}
          className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
            scanAgainPrimary
              ? "bg-accent hover:bg-accent-dark text-white"
              : "border border-border hover:bg-surface-hover"
          }`}
        >
          {t("scan.scanAgain")}
        </button>
      </div>
    </div>
  );
}
