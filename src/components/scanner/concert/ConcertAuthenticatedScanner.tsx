"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CameraScanner } from "../CameraScanner";
import { extractConcertOrderId } from "../extractors";
import type { ScannerEventInfo } from "../PinEntry";
import { ScannerShell } from "../ScannerShell";
import { ConcertManualSearch, type ScanOrder } from "./ConcertManualSearch";
import { ConcertTicketInfo } from "./ConcertTicketInfo";

export function ConcertAuthenticatedScanner({
  event,
  scannerToken,
  onLogout,
  readerId = "concert-qr-reader",
}: {
  event: ScannerEventInfo;
  scannerToken: string;
  onLogout?: () => void;
  readerId?: string;
}) {
  const [scannedOrderId, setScannedOrderId] = useState<string | null>(null);
  // Orders come from the scanner-token server route (orders aren't client-
  // readable anymore). Used for the live counts and the manual search list.
  const [orders, setOrders] = useState<ScanOrder[]>([]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/scan/data", {
        headers: { Authorization: `Bearer ${scannerToken}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setOrders((json.orders ?? []) as ScanOrder[]);
    } catch {
      /* keep last known data on transient failure */
    }
  }, [scannerToken]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 15000);
    return () => clearInterval(interval);
  }, [refetch]);

  const counts = useMemo(() => {
    const approved = orders.filter((o) => o.status === "approved");
    const scanned = approved.filter((o) => o.visited);
    return { scanned: scanned.length, total: approved.length };
  }, [orders]);

  return (
    <ScannerShell
      event={event}
      counts={counts}
      onLogout={onLogout}
      scannedContent={
        scannedOrderId ? (
          <ConcertTicketInfo
            orderId={scannedOrderId}
            onReset={() => setScannedOrderId(null)}
            scannerToken={scannerToken}
            scopedConcertId={event.id}
            onMarked={refetch}
          />
        ) : null
      }
      cameraSlot={
        <CameraScanner
          onScan={setScannedOrderId}
          extractOrderId={extractConcertOrderId}
          readerId={readerId}
        />
      }
      manualSearch={
        <ConcertManualSearch orders={orders} onSelect={setScannedOrderId} />
      }
    />
  );
}
