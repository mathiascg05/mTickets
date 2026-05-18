"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraScanner } from "../CameraScanner";
import { extractGuestOrderId } from "../extractors";
import type { ScannerEventInfo } from "../PinEntry";
import { ScannerShell } from "../ScannerShell";
import { GuestListManualSearch } from "./GuestListManualSearch";
import { GuestListTicketInfo } from "./GuestListTicketInfo";
import type { GuestOrder } from "./types";

export function GuestListAuthenticatedScanner({
  event,
  scannerToken,
  onLogout,
  readerId = "gl-qr-reader",
}: {
  event: ScannerEventInfo;
  scannerToken: string;
  onLogout: () => void;
  readerId?: string;
}) {
  const { t } = useLanguage();
  const [scannedOrderId, setScannedOrderId] = useState<string | null>(null);
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/guest-list/scan/data", {
        headers: { Authorization: `Bearer ${scannerToken}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          onLogout();
          return;
        }
        setLoadError(t("scan.connectionError"));
        return;
      }
      const body = await res.json();
      setOrders(body.orders ?? []);
      setLoadError(null);
    } catch {
      setLoadError(t("scan.connectionError"));
    }
  }, [scannerToken, onLogout, t]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const counts = useMemo(() => {
    const approved = orders.filter((o) => o.status === "approved");
    const scanned = approved.filter((o) => o.visited);
    return { scanned: scanned.length, total: approved.length };
  }, [orders]);

  const selectedOrder = scannedOrderId
    ? orders.find((o) => o.id === scannedOrderId)
    : undefined;

  return (
    <ScannerShell
      event={event}
      counts={counts}
      loadError={loadError}
      onLogout={onLogout}
      scannedContent={
        scannedOrderId ? (
          <GuestListTicketInfo
            order={selectedOrder}
            onReset={() => setScannedOrderId(null)}
            scannerToken={scannerToken}
            onMarked={fetchData}
          />
        ) : null
      }
      cameraSlot={
        <CameraScanner
          onScan={setScannedOrderId}
          extractOrderId={extractGuestOrderId}
          readerId={readerId}
        />
      }
      manualSearch={
        <GuestListManualSearch orders={orders} onSelect={setScannedOrderId} />
      }
    />
  );
}
