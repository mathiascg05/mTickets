"use client";

import { db } from "@/lib/db";
import { useMemo, useState } from "react";
import { CameraScanner } from "../CameraScanner";
import { extractConcertOrderId } from "../extractors";
import type { ScannerEventInfo } from "../PinEntry";
import { ScannerShell } from "../ScannerShell";
import { ConcertManualSearch } from "./ConcertManualSearch";
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

  const { data: countData } = db.useQuery({
    orders: {
      $: { where: { "ticketType.concert.id": event.id } },
    },
  });
  const counts = useMemo(() => {
    const orders = countData?.orders ?? [];
    const approved = orders.filter((o) => o.status === "approved");
    const scanned = approved.filter((o) => o.visited);
    return { scanned: scanned.length, total: approved.length };
  }, [countData]);

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
        <ConcertManualSearch
          concertId={event.id}
          onSelect={setScannedOrderId}
        />
      }
    />
  );
}
