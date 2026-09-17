"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import { id } from "@instantdb/react";
import { toast } from "sonner";
import { useLanguage } from "@/lib/LanguageContext";
import { currencySymbol } from "@/lib/currency";
import { extraSoldQty } from "@/lib/extras";

export type AdminExtra = {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock?: number;
  active?: boolean;
  purchasable?: boolean;
  sortOrder?: number;
  purchaseItems?: {
    quantity: number;
    group?: { orders?: { status?: string }[] } | { orders?: { status?: string }[] }[];
  }[];
  redemptions?: { id: string }[];
};

/**
 * Extras catalog for one concert. Mirrors PaymentMethodsSection: a card per
 * item, a switch that flips `active`, badges for the at-a-glance state and an
 * expandable body with a Save button that only shows once something changed.
 */
export function ExtrasSection({
  concertId,
  extras,
  currency,
}: {
  concertId: string;
  extras: AdminExtra[];
  currency?: string;
}) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [purchasable, setPurchasable] = useState(true);
  const sym = currencySymbol(currency);

  async function addExtra(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("admin.extrasNameRequired"));
      return;
    }
    const priceValue = price.trim() === "" ? 0 : parseFloat(price);
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      toast.error(t("admin.extrasPriceInvalid"));
      return;
    }
    const stockValue = stock.trim() === "" ? undefined : parseInt(stock, 10);
    if (stockValue !== undefined && (!Number.isInteger(stockValue) || stockValue < 0)) {
      toast.error(t("admin.extrasStockInvalid"));
      return;
    }
    try {
      await db.transact(
        db.tx.extras[id()]
          .update({
            name: trimmed,
            price: priceValue,
            ...(stockValue !== undefined ? { stock: stockValue } : {}),
            active: true,
            purchasable,
            // Derivado del maximo, no de la cantidad: borrar un extra del medio
            // haria que `extras.length` repitiera un sortOrder ya usado, y con
            // empates el orden de la lista queda arbitrario.
            sortOrder: extras.reduce((max, e) => Math.max(max, e.sortOrder ?? 0), -1) + 1,
            createdAt: Date.now(),
          })
          .link({ concert: concertId }),
      );
      setName("");
      setPrice("");
      setStock("");
      setPurchasable(true);
      setShowForm(false);
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("admin.extras")}</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? t("common.cancel") : t("admin.extrasAdd")}
        </button>
      </div>

      {showForm && (
        <form onSubmit={addExtra} className="mb-4 space-y-3 border border-border rounded-lg p-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("admin.extrasName")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("admin.extrasPrice")}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("admin.extrasStock")}
              </label>
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder={t("admin.extrasStockHint")}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={purchasable}
              onChange={(e) => setPurchasable(e.target.checked)}
              className="accent-accent"
            />
            {t("admin.extrasPurchasable")}
          </label>
          <button
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("admin.extrasAdd")}
          </button>
        </form>
      )}

      {extras.length === 0 ? (
        <p className="text-sm text-muted">{t("admin.extrasEmpty")}</p>
      ) : (
        <div className="space-y-3">
          {extras.map((extra) => (
            <ExtraCard key={extra.id} extra={extra} sym={sym} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExtraCard({ extra, sym }: { extra: AdminExtra; sym: string }) {
  const { t } = useLanguage();
  const [name, setName] = useState(extra.name);
  const [description, setDescription] = useState(extra.description ?? "");
  const [price, setPrice] = useState(String(extra.price));
  const [stock, setStock] = useState(extra.stock == null ? "" : String(extra.stock));
  const [purchasable, setPurchasable] = useState(extra.purchasable !== false);
  const [sortOrder, setSortOrder] = useState(String(extra.sortOrder ?? 0));
  const [dirty, setDirty] = useState(false);

  const enabled = extra.active !== false;
  const sold = extraSoldQty(extra.purchaseItems);
  const delivered = extra.redemptions?.length ?? 0;
  // An extra that already changed hands is history, not config: it can be
  // deactivated but never deleted, so no buyer loses a right they paid for.
  const hasHistory = sold > 0 || delivered > 0;

  const touch = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  async function toggleActive() {
    try {
      await db.transact(db.tx.extras[extra.id].update({ active: !enabled }));
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t("admin.extrasNameRequired"));
      return;
    }
    const priceValue = price.trim() === "" ? 0 : parseFloat(price);
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      toast.error(t("admin.extrasPriceInvalid"));
      return;
    }
    const stockValue = stock.trim() === "" ? null : parseInt(stock, 10);
    if (stockValue !== null && (!Number.isInteger(stockValue) || stockValue < 0)) {
      toast.error(t("admin.extrasStockInvalid"));
      return;
    }
    const orderValue = parseInt(sortOrder, 10);
    try {
      await db.transact([
        db.tx.extras[extra.id].update({
          name: trimmed,
          price: priceValue,
          purchasable,
          sortOrder: Number.isInteger(orderValue) ? orderValue : 0,
        }),
        // merge with null is the only way to actually clear an optional field.
        db.tx.extras[extra.id].merge({
          description: description.trim() || null,
          stock: stockValue,
        }),
      ]);
      setDirty(false);
    } catch {
      toast.error(t("common.error"));
    }
  }

  async function remove() {
    if (hasHistory) {
      toast.error(t("admin.extrasDeleteBlocked"));
      return;
    }
    if (!confirm(t("admin.extrasDeleteConfirm"))) return;
    try {
      await db.transact(db.tx.extras[extra.id].delete());
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <div
      className={`border rounded-lg transition-colors ${
        enabled ? "border-accent/40 bg-background" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={toggleActive}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? "bg-accent" : "bg-border"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className="font-medium truncate">{extra.name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-accent/15 text-accent-light">
            {sym}
            {extra.price.toFixed(2)}
          </span>
          {extra.purchasable === false && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-warning/15 text-warning">
              {t("admin.extrasNotPurchasable")}
            </span>
          )}
          {extra.stock != null && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-success/15 text-success">
              {Math.max(0, extra.stock - sold)}/{extra.stock}
            </span>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
        <p className="text-xs text-muted">
          {sold} {t("admin.extrasSold")} · {delivered} {t("admin.extrasDelivered")}
        </p>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("admin.extrasName")}
          </label>
          <input
            value={name}
            onChange={(e) => touch(setName)(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            {t("admin.extrasDescription")}
          </label>
          <input
            value={description}
            onChange={(e) => touch(setDescription)(e.target.value)}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("admin.extrasPrice")}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => touch(setPrice)(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("admin.extrasStock")}
            </label>
            <input
              type="number"
              min="0"
              value={stock}
              onChange={(e) => touch(setStock)(e.target.value)}
              placeholder={t("admin.extrasStockUnlimited")}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("admin.extrasSortOrder")}
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => touch(setSortOrder)(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            />
            <p className="text-xs text-muted mt-1">
              {t("admin.extrasSortOrderHint")}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={purchasable}
            onChange={(e) => touch(setPurchasable)(e.target.checked)}
            className="accent-accent"
          />
          {t("admin.extrasPurchasable")}
        </label>

        <div className="flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={save}
              className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.saveChanges")}
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            disabled={hasHistory}
            title={hasHistory ? t("admin.extrasDeleteBlocked") : undefined}
            className="px-3 py-2 border border-border rounded-lg text-sm text-muted hover:text-danger hover:border-danger/50 disabled:opacity-40 transition-colors"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
