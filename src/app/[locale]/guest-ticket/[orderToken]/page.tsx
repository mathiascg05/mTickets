"use client";

import { use, useEffect, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";

type OrderData = {
  order: {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    pricePaid: number;
    orderNumber: string | null;
    visited: boolean;
    visitedAt: number | null;
  };
  event: {
    name: string;
    date: string;
    venue: string;
    venueMapUrl: string;
    flyerUrl: string;
    logoUrl: string;
    primaryColor: string;
  };
};

export default function GuestTicketPage({
  params,
}: {
  params: Promise<{ orderToken: string }>;
}) {
  const { orderToken } = use(params);
  const { t } = useLanguage();
  const [data, setData] = useState<OrderData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    async function load() {
      try {
        const res = await fetch(`/api/guest-list/order/${orderToken}`);
        const body = await res.json();
        if (abort) return;
        if (!res.ok) {
          setError(body.error || "Error");
          return;
        }
        setData(body);
        if (body.order.status === "approved" && interval) {
          clearInterval(interval);
        }
      } catch (err) {
        if (!abort) setError(String(err));
      }
    }
    load();
    interval = setInterval(load, 5000);
    return () => {
      abort = true;
      if (interval) clearInterval(interval);
    };
  }, [orderToken]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm w-full text-center">
          <p className="text-danger font-semibold">{error}</p>
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

  const { order, event } = data;
  const primary = event.primaryColor;
  const isApproved = order.status === "approved";
  const qrPayload = `gl:${order.id}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrPayload)}`;

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="max-w-md mx-auto space-y-5">
        <div
          className="rounded-2xl overflow-hidden bg-surface border"
          style={{ borderColor: `${primary}40` }}
        >
          {event.flyerUrl && (
            <img src={event.flyerUrl} alt={event.name} className="w-full" />
          )}
          <div className="p-6 space-y-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: primary }}>
                {event.name}
              </h1>
              <p className="text-sm text-muted mt-1">
                {event.date}
                {event.venue ? ` · ${event.venue}` : ""}
              </p>
            </div>

            {isApproved ? (
              <>
                <div
                  className="rounded-xl p-6 text-center"
                  style={{ background: `${primary}10` }}
                >
                  <img
                    src={qrUrl}
                    alt="QR"
                    className="mx-auto rounded-lg bg-white p-3"
                    width={240}
                    height={240}
                  />
                  {order.orderNumber && (
                    <p
                      className="font-mono font-bold mt-3 tracking-wider"
                      style={{ color: primary }}
                    >
                      {order.orderNumber}
                    </p>
                  )}
                  <p className="text-sm mt-1">
                    {order.firstName} {order.lastName}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    {order.pricePaid === 0
                      ? t("guestList.cortesia")
                      : `$${order.pricePaid.toFixed(2)}`}
                  </p>
                </div>
                {order.visited && (
                  <div className="text-center text-xs text-success">
                    ✓ {t("guestList.alreadyScanned")}
                  </div>
                )}
              </>
            ) : order.status === "pending" ? (
              <div
                className="rounded-xl p-6 text-center bg-yellow-500/10 border border-yellow-500/30"
              >
                <p className="text-3xl">⏳</p>
                <p className="font-semibold mt-2">{t("guestList.pendingTitle")}</p>
                <p className="text-sm text-muted mt-1">{t("guestList.pendingHelp")}</p>
              </div>
            ) : (
              <div className="rounded-xl p-6 text-center bg-danger/10 border border-danger/30">
                <p className="font-semibold text-danger">
                  {order.status === "cancelled"
                    ? t("guestList.cancelledTitle")
                    : order.status === "rejected"
                      ? t("guestList.rejectedTitle")
                      : order.status}
                </p>
              </div>
            )}

            {event.venueMapUrl && (
              <a
                href={event.venueMapUrl}
                target="_blank"
                rel="noreferrer"
                className="block w-full text-center py-2.5 rounded-xl font-medium border"
                style={{ borderColor: `${primary}40`, color: primary }}
              >
                {t("guestList.viewMap")}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
