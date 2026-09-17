"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import { id } from "@instantdb/react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/LanguageContext";
import { unwrapOne } from "@/lib/extras";

export type IncludedExtraRow = {
  id: string;
  includedQty: number;
  extra?: { id: string; name: string } | { id: string; name: string }[];
};

/**
 * "This ticket type includes N of X". The right belongs to the TICKET, so in an
 * area each companion QR gets its own — a 8-person area that includes one drink
 * hands out eight drinks.
 */
export function IncludedExtrasEditor({
  ticketTypeId,
  includedExtras,
  catalog,
}: {
  ticketTypeId: string;
  includedExtras: IncludedExtraRow[];
  catalog: { id: string; name: string }[];
}) {
  const { t } = useLanguage();
  const [adding, setAdding] = useState("");

  const linkedIds = new Set(
    includedExtras
      .map((row) => unwrapOne<{ id: string }>(row.extra)?.id)
      .filter(Boolean) as string[],
  );
  const available = catalog.filter((e) => !linkedIds.has(e.id));

  async function addLink(extraId: string) {
    if (!extraId) return;
    try {
      await db.transact(
        db.tx.ticketTypeExtras[id()]
          .update({ includedQty: 1, createdAt: Date.now() })
          .link({ ticketType: ticketTypeId, extra: extraId }),
      );
      setAdding("");
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function setQty(rowId: string, qty: number) {
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return;
    try {
      await db.transact(db.tx.ticketTypeExtras[rowId].update({ includedQty: qty }));
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function removeLink(rowId: string) {
    try {
      await db.transact(db.tx.ticketTypeExtras[rowId].delete());
    } catch {
      toast.error(t("common.error"));
    }
  }

  if (catalog.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-sm font-medium mb-2">{t("admin.extrasIncludedTitle")}</p>

      {includedExtras.length === 0 ? (
        <p className="text-xs text-muted mb-2">{t("admin.extrasIncludedEmpty")}</p>
      ) : (
        <ul className="space-y-2 mb-2">
          {includedExtras.map((row) => {
            const extra = unwrapOne<{ id: string; name: string }>(row.extra);
            if (!extra) return null;
            return (
              <li key={row.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{extra.name}</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={row.includedQty}
                  onChange={(e) => setQty(row.id, parseInt(e.target.value, 10))}
                  title={t("admin.extrasIncludedQty")}
                  className="w-16 px-2 py-1 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeLink(row.id)}
                  className="px-2 py-1 border border-border rounded-lg text-xs text-muted hover:text-danger hover:border-danger/50 transition-colors"
                >
                  {t("common.delete")}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {available.length > 0 && (
        <select
          value={adding}
          onChange={(e) => addLink(e.target.value)}
          className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
        >
          <option value="">{t("admin.extrasIncludedAdd")}</option>
          {available.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
