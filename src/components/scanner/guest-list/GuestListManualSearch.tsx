"use client";

import { useMemo, useState } from "react";
import { extractGuestOrderId, normalize } from "../extractors";
import { SearchUI, type SearchableOrder } from "../SearchUI";
import type { GuestOrder } from "./types";

export function GuestListManualSearch({
  orders,
  onSelect,
}: {
  orders: GuestOrder[];
  onSelect: (orderId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const trimmed = query.trim();
  const results: SearchableOrder[] = useMemo(() => {
    if (!trimmed) return [];
    const direct = extractGuestOrderId(trimmed);
    if (direct) {
      const hit = orders.find((o) => o.id === direct);
      if (hit) {
        return [
          {
            id: hit.id,
            firstName: hit.firstName,
            lastName: hit.lastName,
            cedula: hit.cedula,
            orderNumber: hit.orderNumber ?? undefined,
            status: hit.status,
            visited: hit.visited,
            ticketTypeName: hit.ticketType?.name,
          },
        ];
      }
    }
    const q = normalize(trimmed);
    return orders
      .filter((o) => {
        const name = normalize(`${o.firstName ?? ""} ${o.lastName ?? ""}`);
        const cedula = normalize(o.cedula ?? "");
        const orderNum = normalize(o.orderNumber ?? "");
        return name.includes(q) || cedula.includes(q) || orderNum.includes(q);
      })
      .slice(0, 10)
      .map((o) => ({
        id: o.id,
        firstName: o.firstName,
        lastName: o.lastName,
        cedula: o.cedula,
        orderNumber: o.orderNumber ?? undefined,
        status: o.status,
        visited: o.visited,
        ticketTypeName: o.ticketType?.name,
      }));
  }, [orders, trimmed]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (results.length === 1) {
      onSelect(results[0].id);
      setQuery("");
      return;
    }
    const direct =
      extractGuestOrderId(trimmed) ||
      (/^[a-f0-9-]{6,}$/i.test(trimmed) ? trimmed : null);
    if (direct && results.length === 0) {
      onSelect(direct);
      setQuery("");
    }
  }

  return (
    <SearchUI
      query={query}
      setQuery={setQuery}
      handleSubmit={handleSubmit}
      results={results}
      trimmed={trimmed}
      onSelect={onSelect}
    />
  );
}
