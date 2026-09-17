"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { playFeedback } from "../feedback";
import type { Entitlement } from "@/lib/extras";

/**
 * Extras zone of the scan result, rendered UNDER the access zone.
 *
 * Renders nothing at all when this person holds no extras, so a ticket without
 * them looks exactly like it always has. Redeeming here never touches
 * `visited`: a valet can hand over the parking spot before the person walks in.
 */
export function ConcertExtrasPanel({
  orderId,
  scannerToken,
  entitlements,
  approved,
  onChange,
}: {
  orderId: string;
  scannerToken: string;
  entitlements: Entitlement[];
  approved: boolean;
  onChange: (next: Entitlement[]) => void;
}) {
  const { t } = useLanguage();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justRedeemed, setJustRedeemed] = useState<string | null>(null);

  if (entitlements.length === 0) return null;

  async function redeem(item: Entitlement) {
    setBusyKey(item.poolKey);
    setError(null);
    setJustRedeemed(null);
    try {
      const res = await fetch("/api/scan/redeem-extra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          extraId: item.extraId,
          source: item.source,
          units: 1,
          scannerToken,
          // One redemption per button press: a retry of the same press must not
          // burn a second unit.
          clientRequestId: `${item.poolKey}:${item.redeemed}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || t("scan.extrasRedeemFailed"));
        playFeedback("error");
        if (Array.isArray(json.entitlements)) onChange(json.entitlements);
        return;
      }
      onChange(json.entitlements as Entitlement[]);
      setJustRedeemed(item.poolKey);
      playFeedback("success");
    } catch {
      setError(t("scan.offline"));
      playFeedback("error");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-muted uppercase tracking-wide">
        {t("scan.extrasTitle")}
      </p>

      {!approved && (
        <p className="text-sm text-warning">{t("scan.extrasNeedsApproval")}</p>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-center text-sm text-danger">
          {error}
        </div>
      )}

      <ul className="space-y-2">
        {entitlements.map((item) => {
          const done = item.remaining === 0;
          return (
            <li
              key={item.poolKey}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{item.name}</p>
                <p className="text-sm text-muted">
                  {item.source === "purchased"
                    ? t("scan.extrasBalanceGroup", {
                        redeemed: item.redeemed,
                        total: item.total,
                      })
                    : t("scan.extrasBalance", {
                        redeemed: item.redeemed,
                        total: item.total,
                      })}
                  {justRedeemed === item.poolKey && (
                    <span className="text-success"> ✓</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => redeem(item)}
                disabled={done || !approved || busyKey !== null}
                className="shrink-0 px-5 py-3 rounded-lg font-semibold transition-colors bg-accent hover:bg-accent-dark text-white disabled:opacity-40 disabled:hover:bg-accent"
              >
                {busyKey === item.poolKey
                  ? t("scan.extrasRedeeming")
                  : done
                    ? t("scan.extrasDone")
                    : t("scan.extrasRedeem")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
