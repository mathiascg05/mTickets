"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { useState } from "react";
import { playFeedback } from "../feedback";
import type { GuestOrder } from "./types";

export function GuestListTicketInfo({
  order,
  onReset,
  scannerToken,
  onMarked,
}: {
  order: GuestOrder | undefined;
  onReset: () => void;
  scannerToken: string;
  onMarked: () => void;
}) {
  const { t } = useLanguage();
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [markSuccess, setMarkSuccess] = useState(false);

  if (!order) {
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

  async function markVisited() {
    if (!order) return;
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch("/api/guest-list/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, scannerToken }),
      });
      if (!res.ok) {
        let msg = t("scan.markFailed");
        try {
          const body = await res.json();
          if (body.error === "ALREADY_SCANNED") {
            msg = t("scan.alreadyScanned");
          } else if (body.error === "TICKET_NOT_APPROVED") {
            msg = t("scan.notApproved");
          } else if (body.error === "Wrong event") {
            msg = t("guestList.scanWrongEvent");
          } else if (body.error) {
            msg = body.error;
          }
        } catch {}
        setMarkError(msg);
        playFeedback("error");
        return;
      }
      setMarkSuccess(true);
      playFeedback("success");
      onMarked();
    } catch {
      setMarkError(t("scan.offline"));
      playFeedback("error");
    } finally {
      setMarking(false);
    }
  }

  const isApproved = order.status === "approved";
  const isVisited = order.visited;
  const showMarkButton = isApproved && !isVisited && !markSuccess;
  const scanAgainPrimary = !showMarkButton;

  return (
    <div className="space-y-4">
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
            {order.firstName} {order.lastName}
            {order.ticketType?.name ? ` · ${order.ticketType.name}` : ""}
          </p>
        </div>
      )}

      <div className="bg-surface border border-border rounded-xl p-6">
        <div className="text-center mb-4">
          {(isApproved && !isVisited) || markSuccess ? (
            <div className="text-5xl mb-2 text-success">{"✓"}</div>
          ) : null}
          {order.orderNumber && (
            <p className="text-sm font-mono font-bold text-accent-light tracking-wide mb-1">
              {order.orderNumber}
            </p>
          )}
          {order.ticketType?.name && (
            <p className="text-muted">{order.ticketType.name}</p>
          )}
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
          {order.cedula && (
            <div>
              <p className="text-muted">{t("scan.fieldCedula")}</p>
              <p className="font-medium">{order.cedula}</p>
            </div>
          )}
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
