"use client";

import { db } from "@/lib/db";
import { useMemo, useState } from "react";
import { extractConcertOrderId, normalize } from "../extractors";
import { SearchUI, type SearchableOrder } from "../SearchUI";

export function ConcertManualSearch({
  concertId,
  onSelect,
}: {
  concertId: string;
  onSelect: (orderId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const { data } = db.useQuery({
    concerts: {
      $: { where: { id: concertId } },
      ticketTypes: {
        orders: {},
      },
    },
  });

  const allOrders: SearchableOrder[] = useMemo(() => {
    const concert = data?.concerts?.[0];
    if (!concert) return [];
    return concert.ticketTypes.flatMap((tt) =>
      tt.orders.map((o) => ({
        id: o.id,
        firstName: o.firstName,
        lastName: o.lastName,
        cedula: o.cedula,
        orderNumber: o.orderNumber ?? undefined,
        status: o.status,
        visited: o.visited,
        ticketTypeName: tt.name,
      })),
    );
  }, [data]);

  const trimmed = query.trim();
  const results: SearchableOrder[] = useMemo(() => {
    if (!trimmed) return [];
    const direct = extractConcertOrderId(trimmed);
    if (direct) {
      const hit = allOrders.find((o) => o.id === direct);
      if (hit) return [hit];
    }
    const q = normalize(trimmed);
    return allOrders
      .filter((o) => {
        const name = normalize(`${o.firstName ?? ""} ${o.lastName ?? ""}`);
        const cedula = normalize(o.cedula ?? "");
        const orderNum = normalize(o.orderNumber ?? "");
        return name.includes(q) || cedula.includes(q) || orderNum.includes(q);
      })
      .slice(0, 10);
  }, [allOrders, trimmed]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (results.length === 1) {
      onSelect(results[0].id);
      setQuery("");
      return;
    }
    const direct =
      extractConcertOrderId(trimmed) ||
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
