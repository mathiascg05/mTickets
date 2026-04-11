"use client";

import { db } from "@/lib/db";
import { getActivePhase, getTodayString } from "@/lib/phases";
import type { Phase } from "@/lib/phases";
import { id } from "@instantdb/react";
import { extractDominantColor } from "@/lib/colorExtract";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";
import { getFieldTypeLabel } from "@/lib/i18n";
import { useAuthContext } from "@/lib/AuthContext";

export default function AdminConcertEditPage() {
  const params = useParams();
  const concertId = params.id as string;

  const { isSuperAdmin } = useAuthContext();

  const { isLoading, data } = db.useQuery({
    concerts: {
      $: { where: { id: concertId } },
      ticketTypes: {
        $: { order: { createdAt: "asc" } },
        orders: {},
        phases: {
          $: { order: { sortOrder: "asc" } },
        },
      },
      paymentMethods: {
        $: { order: { createdAt: "asc" } },
      },
      customFields: {
        $: { order: { sortOrder: "asc" } },
      },
      coupons: {
        $: { order: { createdAt: "asc" } },
      },
      platformFeeConfig: {},
    },
  });

  const { t } = useLanguage();

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }

  const concert = data.concerts[0];
  if (!concert) {
    return <div className="text-muted">{t("admin.eventNotFound")}</div>;
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">{concert.name}</h1>
      <EventLink slug={concert.slug} />

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <div className="space-y-6">
          <ConcertEditForm concert={concert} />
          <PaymentMethodsSection
            concertId={concertId}
            paymentMethods={concert.paymentMethods}
          />
          <CustomFieldsSection
            concertId={concertId}
            customFields={concert.customFields}
          />
          <CouponsSection
            concertId={concertId}
            coupons={concert.coupons}
            allOrders={concert.ticketTypes.flatMap((tt) => tt.orders)}
          />
          <ScannerPinSection
            concertId={concertId}
            currentPin={concert.scannerPin}
          />
          <BrandingSection
            concertId={concertId}
            flyerUrl={concert.flyerUrl}
            logoUrl={concert.logoUrl}
            primaryColor={concert.primaryColor}
          />
          <PlatformFeeSection
            concertId={concertId}
            feeConfig={concert.platformFeeConfig}
            isSuperAdmin={isSuperAdmin}
          />
        </div>
        <div className="space-y-6">
          <TicketTypesSection
            concertId={concertId}
            ticketTypes={concert.ticketTypes}
          />
          <FeesSection ticketTypes={concert.ticketTypes} />
        </div>
      </div>
    </div>
  );
}

function EventLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useLanguage();
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/events/${slug}`
      : `/events/${slug}`;

  function handleCopy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-sm text-muted truncate">{url}</span>
      <button
        onClick={handleCopy}
        className="px-3 py-1 text-xs font-medium rounded-lg border border-border hover:border-accent/50 text-muted hover:text-accent-light transition-colors flex-shrink-0"
      >
        {copied ? t("common.copied") : t("common.copyLink")}
      </button>
    </div>
  );
}

type ConcertData = {
  id: string;
  name: string;
  date: string;
  venue?: string;
  description?: string;
  status: string;
  defaultLanguage?: string;
};

function ConcertEditForm({ concert }: { concert: ConcertData }) {
  const { t } = useLanguage();
  const [name, setName] = useState(concert.name);
  const [date, setDate] = useState(concert.date);
  const [venue, setVenue] = useState(concert.venue);
  const [description, setDescription] = useState(concert.description);
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    db.transact(
      db.tx.concerts[concert.id].update({
        name,
        date,
        venue,
        description,
      }),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function toggleStatus() {
    const newStatus = concert.status === "active" ? "draft" : "active";
    db.transact(db.tx.concerts[concert.id].update({ status: newStatus }));
  }

  function deleteConcert() {
    if (confirm(t("admin.deleteEventConfirm"))) {
      db.transact(db.tx.concerts[concert.id].delete());
      window.location.href = "/admin/concerts";
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("admin.eventDetails")}</h2>
        <button
          onClick={toggleStatus}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            concert.status === "active"
              ? "bg-success/10 text-success border-success/30 hover:bg-success/20"
              : "bg-muted/10 text-muted border-muted/30 hover:bg-muted/20"
          }`}
        >
          {concert.status === "active" ? t("common.active") : t("common.draft")} {t("admin.clickToToggle")}
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">{t("common.name")}</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t("common.date")}</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t("common.venue")}</label>
          <input
            required
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("common.description")}
          </label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors resize-none"
            placeholder={t("admin.descPlaceholder")}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t("admin.eventLanguage")}</label>
          <select
            value={concert.defaultLanguage || "es"}
            onChange={(e) =>
              db.transact(
                db.tx.concerts[concert.id].update({
                  defaultLanguage: e.target.value,
                }),
              )
            }
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
          >
            {t("common.saveChanges")}
          </button>
          {saved && (
            <span className="text-success text-sm">{"✓"} {t("common.saved")}</span>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={deleteConcert}
              className="ml-auto px-4 py-2.5 text-danger hover:bg-danger/10 rounded-lg text-sm font-medium transition-colors"
            >
              {t("admin.deleteEvent")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

const BASE_METHODS = [
  { type: "efectivo", name: "Efectivo" },
  { type: "zelle", name: "Zelle" },
  { type: "pago_movil", name: "Pago Movil" },
] as const;

type PaymentMethodData = {
  id: string;
  type?: string;
  name: string;
  instructions?: string;
  convertCurrency?: string;
  requireScreenshot?: boolean;
  requireReferenceNumber?: boolean;
  zelleEmail?: string;
  zelleName?: string;
  pmCedula?: string;
  pmPhone?: string;
  pmBank?: string;
};

function PaymentMethodCard({
  concertId,
  base,
  existing,
}: {
  concertId: string;
  base: (typeof BASE_METHODS)[number];
  existing: PaymentMethodData | undefined;
}) {
  const { t } = useLanguage();
  const [instructions, setInstructions] = useState(existing?.instructions || "");
  const [convertCurrency, setConvertCurrency] = useState(existing?.convertCurrency || "");
  const [requireScreenshot, setRequireScreenshot] = useState(existing?.requireScreenshot !== false);
  const [requireReferenceNumber, setRequireReferenceNumber] = useState(existing?.requireReferenceNumber === true);
  const [zelleEmail, setZelleEmail] = useState(existing?.zelleEmail || "");
  const [zelleName, setZelleName] = useState(existing?.zelleName || "");
  const [pmCedula, setPmCedula] = useState(existing?.pmCedula || "");
  const [pmPhone, setPmPhone] = useState(existing?.pmPhone || "");
  const [pmBank, setPmBank] = useState(existing?.pmBank || "");
  const [dirty, setDirty] = useState(false);

  const enabled = !!existing;

  function toggle() {
    if (enabled) {
      if (confirm(t("admin.disable", { name: base.name }))) {
        db.transact(db.tx.paymentMethods[existing!.id].delete());
      }
    } else {
      db.transact(
        db.tx.paymentMethods[id()]
          .update({
            type: base.type,
            name: base.name,
            instructions: "",
            requireScreenshot: true,
            requireReferenceNumber: false,
            createdAt: Date.now(),
          })
          .link({ concert: concertId }),
      );
    }
  }

  function saveConfig() {
    if (!existing) return;
    db.transact(
      db.tx.paymentMethods[existing.id].update({
        instructions: instructions || undefined,
        convertCurrency: convertCurrency || undefined,
        requireScreenshot,
        requireReferenceNumber,
        ...(base.type === "zelle" ? { zelleEmail: zelleEmail || undefined, zelleName: zelleName || undefined } : {}),
        ...(base.type === "pago_movil" ? { pmCedula: pmCedula || undefined, pmPhone: pmPhone || undefined, pmBank: pmBank || undefined } : {}),
      }),
    );
    setDirty(false);
  }

  return (
    <div className={`border rounded-lg transition-colors ${enabled ? "border-accent/40 bg-background" : "border-border"}`}>
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggle}
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
          <span className="font-medium">{base.name}</span>
        </div>
        {enabled && (
          <div className="flex items-center gap-2">
            {existing?.convertCurrency && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-accent/15 text-accent-light">
                {existing.convertCurrency} &rarr; Bs
              </span>
            )}
            {existing?.requireScreenshot !== false && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-success/15 text-success">
                {t("admin.screenshotBadge")}
              </span>
            )}
            {existing?.requireReferenceNumber && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-warning/15 text-warning">
                {t("admin.refBadge")}
              </span>
            )}
          </div>
        )}
      </div>

      {enabled && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {/* Zelle-specific fields */}
          {base.type === "zelle" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.zelleEmail")}</label>
                <input
                  value={zelleEmail}
                  onChange={(e) => { setZelleEmail(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder="correo@ejemplo.com"
                  type="email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.zelleName")}</label>
                <input
                  value={zelleName}
                  onChange={(e) => { setZelleName(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder="Nombre Apellido"
                />
              </div>
            </div>
          )}

          {/* Pago Movil-specific fields */}
          {base.type === "pago_movil" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.pmCedula")}</label>
                <input
                  value={pmCedula}
                  onChange={(e) => { setPmCedula(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder="V-12345678"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.pmPhone")}</label>
                <input
                  value={pmPhone}
                  onChange={(e) => { setPmPhone(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder="0412-1234567"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.pmBank")}</label>
                <input
                  value={pmBank}
                  onChange={(e) => { setPmBank(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder="Banesco, Mercantil..."
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              {t("admin.instructions")} <span className="text-muted font-normal">({t("common.optional")})</span>
            </label>
            <textarea
              value={instructions}
              onChange={(e) => { setInstructions(e.target.value); setDirty(true); }}
              rows={2}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm resize-none"
              placeholder={t("admin.instructionsOptional")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("admin.currencyConversion")}</label>
            <select
              value={convertCurrency}
              onChange={(e) => { setConvertCurrency(e.target.value); setDirty(true); }}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            >
              <option value="">{t("common.none")}</option>
              <option value="USD">USD &rarr; Bs</option>
              <option value="EUR">EUR &rarr; Bs</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">{t("admin.requiredProof")}</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireScreenshot}
                  onChange={(e) => { setRequireScreenshot(e.target.checked); setDirty(true); }}
                  className="accent-accent-light"
                />
                <span className="text-sm">{t("admin.requireScreenshot")}</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireReferenceNumber}
                  onChange={(e) => { setRequireReferenceNumber(e.target.checked); setDirty(true); }}
                  className="accent-accent-light"
                />
                <span className="text-sm">{t("admin.requireRefNumber")}</span>
              </label>
            </div>
          </div>
          {dirty && (
            <button
              onClick={saveConfig}
              className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
            >
              {t("common.saveChanges")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PaymentMethodsSection({
  concertId,
  paymentMethods,
}: {
  concertId: string;
  paymentMethods: PaymentMethodData[];
}) {
  const { t } = useLanguage();
  const [refreshingRate, setRefreshingRate] = useState(false);
  const [rateRefreshed, setRateRefreshed] = useState(false);

  async function refreshBcvRates() {
    setRefreshingRate(true);
    try {
      const [usdRes, eurRes] = await Promise.all([
        fetch("/api/exchange-rates?currency=USD").then((r) => r.json()),
        fetch("/api/exchange-rates?currency=EUR").then((r) => r.json()),
      ]);
      await db.transact([
        db.tx.exchangeRates["a0000000-0000-4000-8000-000000000001"].update({
          currency: "USD",
          rate: usdRes.promedio,
          fetchedAt: Date.now(),
        }),
        db.tx.exchangeRates["a0000000-0000-4000-8000-000000000002"].update({
          currency: "EUR",
          rate: eurRes.promedio,
          fetchedAt: Date.now(),
        }),
      ]);
      setRateRefreshed(true);
      setTimeout(() => setRateRefreshed(false), 2000);
    } catch {
      alert(t("admin.refreshFailed"));
    } finally {
      setRefreshingRate(false);
    }
  }

  const hasConversionMethods = paymentMethods.some((pm) => pm.convertCurrency);

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("admin.paymentMethods")}</h2>
        {hasConversionMethods && (
          <button
            onClick={refreshBcvRates}
            disabled={refreshingRate}
            className="px-3 py-1.5 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {rateRefreshed ? t("common.refreshed") : refreshingRate ? t("admin.refreshing") : t("admin.refreshBcv")}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {BASE_METHODS.map((base) => (
          <PaymentMethodCard
            key={base.type}
            concertId={concertId}
            base={base}
            existing={paymentMethods.find(
              (pm) => pm.type === base.type || (!pm.type && pm.name.toLowerCase() === base.name.toLowerCase()),
            )}
          />
        ))}
      </div>
    </div>
  );
}

type TicketTypeData = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  description?: string;
  visibility?: string;
  hideAvailability?: boolean;
  feePercent?: number;
  feeFixed?: number;
  orders: { id: string; status: string; phaseId?: string }[];
  phases: Phase[];
};

function TicketTypesSection({
  concertId,
  ticketTypes,
}: {
  concertId: string;
  ticketTypes: TicketTypeData[];
}) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [description, setDescription] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    db.transact(
      db.tx.ticketTypes[id()]
        .update({
          name,
          price: parseFloat(price),
          quantity: parseInt(quantity, 10),
          description: description || undefined,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );
    setName("");
    setPrice("");
    setQuantity("");
    setDescription("");
    setShowForm(false);
  }

  function deleteTicketType(ttId: string) {
    if (confirm(t("admin.deleteTicketTypeConfirm"))) {
      db.transact(db.tx.ticketTypes[ttId].delete());
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("admin.ticketTypesTitle")}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {showForm ? t("common.cancel") : t("common.add")}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-4 mb-4 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium mb-1">{t("common.name")}</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder={t("admin.ttNamePlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("common.price")}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="25.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("common.quantity")}
              </label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="100"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("admin.descriptionOptional")}
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("admin.addTicketType")}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {ticketTypes.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            {t("admin.noTicketTypes")}
          </p>
        ) : (
          ticketTypes.map((tt) => {
            const phases = tt.phases || [];
            const hasPhases = phases.length > 0;
            const sold = tt.orders.filter(
              (o) => o.status === "approved" || o.status === "pending",
            ).length;
            const today = getTodayString();
            const active = hasPhases ? getActivePhase(phases, tt.orders, today) : null;
            const totalCapacity = hasPhases
              ? phases.reduce((s, p) => s + p.quantity, 0)
              : tt.quantity;
            return (
              <TicketTypeItem
                key={tt.id}
                tt={tt}
                sold={sold}
                totalCapacity={totalCapacity}
                hasPhases={hasPhases}
                activePhase={active}
                onDelete={() => deleteTicketType(tt.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function TicketTypeItem({
  tt,
  sold,
  totalCapacity,
  hasPhases,
  activePhase,
  onDelete,
}: {
  tt: TicketTypeData;
  sold: number;
  totalCapacity: number;
  hasPhases: boolean;
  activePhase: Phase | null;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [showPhases, setShowPhases] = useState(false);

  return (
    <div className="border border-border rounded-lg">
      <div className="flex items-center justify-between p-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{tt.name}</p>
            {tt.visibility === "hidden" && (
              <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px] font-semibold uppercase tracking-wider">{t("common.hidden")}</span>
            )}
            {tt.visibility === "soldOutOverride" && (
              <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] font-semibold uppercase tracking-wider">{t("admin.forcedSoldOut")}</span>
            )}
          </div>
          {tt.description && (
            <p className="text-sm text-muted">{tt.description}</p>
          )}
          {hasPhases ? (
            <p className="text-sm text-muted mt-1">
              {activePhase ? (
                <>
                  <span className="text-success font-medium">{activePhase.name}</span>
                  {" "}@ ${activePhase.price.toFixed(2)} &middot;{" "}
                </>
              ) : (
                <span className="text-danger font-medium">{t("admin.allPhasesExhausted")} &middot; </span>
              )}
              {t("admin.soldCountPhases", { sold, total: totalCapacity })}
            </p>
          ) : (
            <p className="text-sm text-muted mt-1">
              ${tt.price.toFixed(2)} &middot; {t("admin.soldCount", { sold, total: tt.quantity })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tt.visibility || "visible"}
            onChange={(e) =>
              db.transact(
                db.tx.ticketTypes[tt.id].update({
                  visibility: e.target.value,
                }),
              )
            }
            className="px-2 py-1.5 bg-background border border-border rounded-lg text-xs text-muted focus:outline-none focus:border-accent-light transition-colors"
          >
            <option value="visible">{t("common.visible")}</option>
            <option value="hidden">{t("common.hidden")}</option>
            <option value="soldOutOverride">{t("admin.showAsSoldOut")}</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!tt.hideAvailability}
              onChange={(e) =>
                db.transact(
                  db.tx.ticketTypes[tt.id].update({
                    hideAvailability: !e.target.checked,
                  }),
                )
              }
              className="accent-accent"
            />
            {t("admin.hideAvailability")}
          </label>
          <button
            onClick={() => setShowPhases(!showPhases)}
            className="px-3 py-1.5 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-xs font-medium transition-colors"
          >
            {showPhases ? t("admin.hidePhases") : t("admin.managePhases")}
          </button>
          <button
            onClick={onDelete}
            className="text-muted hover:text-danger transition-colors text-sm"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
      {showPhases && (
        <div className="border-t border-border p-4">
          <PhaseManagement ticketTypeId={tt.id} phases={tt.phases || []} orders={tt.orders} />
        </div>
      )}
    </div>
  );
}

function PhaseManagement({
  ticketTypeId,
  phases,
  orders,
}: {
  ticketTypeId: string;
  phases: Phase[];
  orders: { id: string; status: string; phaseId?: string }[];
}) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [endDate, setEndDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editEndDate, setEditEndDate] = useState("");

  const today = getTodayString();
  const active = getActivePhase(phases, orders, today);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const nextOrder = phases.length > 0
      ? Math.max(...phases.map((p) => p.sortOrder)) + 1
      : 1;
    db.transact(
      db.tx.ticketPhases[id()]
        .update({
          name,
          price: parseFloat(price),
          quantity: parseInt(quantity, 10),
          endDate: endDate || undefined,
          sortOrder: nextOrder,
          createdAt: Date.now(),
        })
        .link({ ticketType: ticketTypeId }),
    );
    setName("");
    setPrice("");
    setQuantity("");
    setEndDate("");
    setShowForm(false);
  }

  function startEdit(p: Phase) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditPrice(String(p.price));
    setEditQuantity(String(p.quantity));
    setEditEndDate(p.endDate || "");
  }

  function saveEdit() {
    if (!editingId) return;
    db.transact(
      db.tx.ticketPhases[editingId].update({
        name: editName,
        price: parseFloat(editPrice),
        quantity: parseInt(editQuantity, 10),
        endDate: editEndDate || undefined,
      }),
    );
    setEditingId(null);
  }

  function deletePhase(phaseId: string) {
    if (confirm(t("admin.deletePhaseConfirm"))) {
      db.transact(db.tx.ticketPhases[phaseId].delete());
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{t("admin.pricingPhases")}</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-2.5 py-1 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors"
        >
          {showForm ? t("common.cancel") : t("admin.addPhase")}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-3 space-y-2"
        >
          <div>
            <label className="block text-xs font-medium mb-1">{t("common.name")}</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder={t("admin.phaseName")}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">{t("common.price")}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="50.00"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t("admin.qty")}</label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t("admin.endDate")}</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors"
          >
            {t("admin.addPhaseButton")}
          </button>
        </form>
      )}

      {phases.length === 0 ? (
        <p className="text-muted text-xs text-center py-3">
          {t("admin.noPhases")}
        </p>
      ) : (
        <div className="space-y-2">
          {phases.map((p) => {
            const phaseSold = orders.filter(
              (o) =>
                o.phaseId === p.id &&
                (o.status === "approved" || o.status === "pending"),
            ).length;
            const isActive = active?.id === p.id;

            if (editingId === p.id) {
              return (
                <div
                  key={p.id}
                  className="bg-background border border-accent/30 rounded-lg p-3 space-y-2"
                >
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("common.name")}</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("common.price")}</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("admin.qty")}</label>
                      <input
                        type="number"
                        min="1"
                        value={editQuantity}
                        onChange={(e) => setEditQuantity(e.target.value)}
                        className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("admin.endDate")}</label>
                      <input
                        type="date"
                        value={editEndDate}
                        onChange={(e) => setEditEndDate(e.target.value)}
                        className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="px-3 py-1 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 text-muted hover:text-foreground text-xs transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={p.id}
                className={`flex items-center justify-between p-3 border rounded-lg ${
                  isActive
                    ? "border-success/40 bg-success/5"
                    : "border-border"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{p.name}</span>
                    {isActive && (
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-success/15 text-success">
                        {t("common.active")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    ${p.price.toFixed(2)} &middot; {t("admin.soldCount", { sold: phaseSold, total: p.quantity })}
                    {p.endDate && <> &middot; {t("admin.ends")} {p.endDate}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-muted hover:text-accent-light transition-colors text-xs"
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    onClick={() => deletePhase(p.id)}
                    className="text-muted hover:text-danger transition-colors text-xs"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FeesSection({ ticketTypes }: { ticketTypes: TicketTypeData[] }) {
  const { t } = useLanguage();
  if (ticketTypes.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-2">{t("admin.serviceFees")}</h2>
        <p className="text-muted text-sm text-center py-6">
          {t("admin.addTicketTypesFirst")}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-1">{t("admin.serviceFees")}</h2>
      <p className="text-muted text-xs mb-4">
        {t("admin.feeDescription")}
      </p>
      <div className="space-y-3">
        {ticketTypes.map((tt) => (
          <FeeRow key={tt.id} tt={tt} />
        ))}
      </div>
    </div>
  );
}

function FeeRow({ tt }: { tt: TicketTypeData }) {
  const { t } = useLanguage();
  const today = getTodayString();
  const phases = tt.phases || [];
  const hasPhases = phases.length > 0;
  const activePhase = hasPhases ? getActivePhase(phases, tt.orders, today) : null;
  const currentPrice = activePhase ? activePhase.price : tt.price;

  const feePercent = tt.feePercent ?? 0;
  const feeFixed = tt.feeFixed ?? 0;
  const calculatedFee = (currentPrice * feePercent) / 100 + feeFixed;

  function updateFee(field: "feePercent" | "feeFixed", value: string) {
    const num = parseFloat(value);
    db.transact(
      db.tx.ticketTypes[tt.id].update({
        [field]: isNaN(num) ? 0 : num,
      }),
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">{tt.name}</p>
        {hasPhases && phases.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {phases.map((p) => (
              <span
                key={p.id}
                className={`text-[11px] px-2 py-0.5 rounded-full border ${
                  activePhase?.id === p.id
                    ? "bg-success/10 text-success border-success/30"
                    : "bg-muted/10 text-muted border-muted/30"
                }`}
              >
                {p.name}: ${p.price.toFixed(2)}
              </span>
            ))}
          </div>
        )}
        {!hasPhases && (
          <p className="text-xs text-muted mt-0.5">
            {t("admin.basePrice")}: ${tt.price.toFixed(2)}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">{t("admin.feePercent")}</label>
          <input
            type="number"
            step="0.1"
            min="0"
            defaultValue={feePercent || ""}
            onBlur={(e) => updateFee("feePercent", e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            placeholder="0"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">{t("admin.feeFixed")}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            defaultValue={feeFixed || ""}
            onBlur={(e) => updateFee("feeFixed", e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            placeholder="0.00"
          />
        </div>
      </div>
      {(feePercent > 0 || feeFixed > 0) && (
        <p className="text-xs text-muted">
          {t("admin.onTicket", { price: currentPrice.toFixed(2) })}:{" "}
          {feePercent > 0 && (
            <span>{t("admin.feeCalcPercent", { amount: ((currentPrice * feePercent) / 100).toFixed(2), percent: feePercent })}</span>
          )}
          {feePercent > 0 && feeFixed > 0 && " + "}
          {feeFixed > 0 && <span>{t("admin.feeCalcFixed", { amount: feeFixed.toFixed(2) })}</span>}
          {" = "}
          <span className="font-medium text-foreground">
            {t("admin.feeCalcTotal", { amount: calculatedFee.toFixed(2) })}
          </span>
        </p>
      )}
    </div>
  );
}

type CouponData = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  maxUses?: number;
  active: boolean;
};

type OrderData = {
  id: string;
  status: string;
  couponCode?: string;
};

function CouponsSection({
  concertId,
  coupons,
  allOrders,
}: {
  concertId: string;
  coupons: CouponData[];
  allOrders: OrderData[];
}) {
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [active, setActive] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editDiscountType, setEditDiscountType] = useState("percentage");
  const [editDiscountValue, setEditDiscountValue] = useState("");
  const [editMaxUses, setEditMaxUses] = useState("");
  const [editActive, setEditActive] = useState(true);

  function getUsageCount(couponCode: string) {
    return allOrders.filter(
      (o) =>
        o.couponCode === couponCode &&
        (o.status === "approved" || o.status === "pending"),
    ).length;
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    db.transact(
      db.tx.coupons[id()]
        .update({
          code: code.toUpperCase().trim(),
          discountType,
          discountValue: parseFloat(discountValue),
          maxUses: maxUses ? parseInt(maxUses, 10) : undefined,
          active,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );
    setCode("");
    setDiscountType("percentage");
    setDiscountValue("");
    setMaxUses("");
    setActive(true);
    setShowForm(false);
  }

  function startEdit(c: CouponData) {
    setEditingId(c.id);
    setEditCode(c.code);
    setEditDiscountType(c.discountType);
    setEditDiscountValue(String(c.discountValue));
    setEditMaxUses(c.maxUses != null ? String(c.maxUses) : "");
    setEditActive(c.active);
  }

  function saveEdit() {
    if (!editingId) return;
    db.transact(
      db.tx.coupons[editingId].update({
        code: editCode.toUpperCase().trim(),
        discountType: editDiscountType,
        discountValue: parseFloat(editDiscountValue),
        maxUses: editMaxUses ? parseInt(editMaxUses, 10) : undefined,
        active: editActive,
      }),
    );
    setEditingId(null);
  }

  function deleteCoupon(couponId: string) {
    if (confirm(t("admin.deleteCouponConfirm"))) {
      db.transact(db.tx.coupons[couponId].delete());
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("admin.coupons")}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {showForm ? t("common.cancel") : t("common.add")}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-4 mb-4 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium mb-1">{t("admin.code")}</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm uppercase"
              placeholder={t("admin.codePlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("admin.discountType")}
              </label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              >
                <option value="percentage">{t("admin.percentage")}</option>
                <option value="amount">{t("admin.fixedAmount")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {discountType === "percentage" ? t("admin.percentageLabel") : t("admin.amountLabel")}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder={discountType === "percentage" ? "20" : "5.00"}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("admin.maxUsesOptional")}
              </label>
              <input
                type="number"
                min="1"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder={t("admin.unlimited")}
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="accent-accent-light"
                />
                <span className="text-sm font-medium">{t("common.active")}</span>
              </label>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            {t("admin.addCoupon")}
          </button>
        </form>
      )}

      <div className="space-y-2">
        {coupons.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            {t("admin.noCoupons")}
          </p>
        ) : (
          coupons.map((c) => {
            const usage = getUsageCount(c.code);
            if (editingId === c.id) {
              return (
                <div
                  key={c.id}
                  className="bg-background border border-accent/30 rounded-lg p-4 space-y-3"
                >
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {t("admin.code")}
                    </label>
                    <input
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                      className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm uppercase"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {t("admin.discountType")}
                      </label>
                      <select
                        value={editDiscountType}
                        onChange={(e) => setEditDiscountType(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                      >
                        <option value="percentage">{t("admin.percentage")}</option>
                        <option value="amount">{t("admin.fixedAmount")}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {editDiscountType === "percentage"
                          ? t("admin.percentageLabel")
                          : t("admin.amountLabel")}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editDiscountValue}
                        onChange={(e) => setEditDiscountValue(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {t("admin.maxUses")}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={editMaxUses}
                        onChange={(e) => setEditMaxUses(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                        placeholder={t("admin.unlimited")}
                      />
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editActive}
                          onChange={(e) => setEditActive(e.target.checked)}
                          className="accent-accent-light"
                        />
                        <span className="text-sm font-medium">{t("common.active")}</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 text-muted hover:text-foreground text-sm transition-colors"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={c.id}
                className="flex items-start justify-between p-3 border border-border rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-sm">
                      {c.code}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        c.active
                          ? "bg-success/15 text-success"
                          : "bg-muted/15 text-muted"
                      }`}
                    >
                      {c.active ? t("common.active") : t("common.inactive")}
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-0.5">
                    {c.discountType === "percentage"
                      ? t("admin.percentOff", { value: c.discountValue })
                      : t("admin.amountOff", { value: c.discountValue.toFixed(2) })}
                    {" \u00B7 "}
                    {t("admin.usedCount", { used: usage, max: c.maxUses != null ? c.maxUses : "\u221E" })}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <button
                    onClick={() => startEdit(c)}
                    className="text-muted hover:text-accent-light transition-colors text-xs"
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    onClick={() => deleteCoupon(c.id)}
                    className="text-muted hover:text-danger transition-colors text-xs"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const FIELD_TYPE_VALUES = ["text", "number", "checkbox", "date", "email", "select", "multiselect"] as const;

type CustomFieldData = {
  id: string;
  label: string;
  fieldType: string;
  required: boolean;
  options?: string;
  sortOrder: number;
};

function CustomFieldCard({
  field,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragOver,
}: {
  field: CustomFieldData;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
}) {
  const { t, lang } = useLanguage();
  const hasOptions = field.fieldType === "select" || field.fieldType === "multiselect";
  let parsedOptions: string[] = [];
  try { parsedOptions = field.options ? JSON.parse(field.options) : []; } catch { /* ignore */ }

  function updateField(updates: Partial<{ label: string; fieldType: string; required: boolean; options: string }>) {
    db.transact(db.tx.customFields[field.id].update(updates));
  }

  function updateOption(index: number, value: string) {
    const next = [...parsedOptions];
    next[index] = value;
    updateField({ options: JSON.stringify(next) });
  }

  function addOption() {
    const next = [...parsedOptions, ""];
    updateField({ options: JSON.stringify(next) });
  }

  function removeOption(index: number) {
    const next = parsedOptions.filter((_, i) => i !== index);
    updateField({ options: JSON.stringify(next) });
  }

  function deleteField() {
    if (confirm(t("admin.deleteField"))) {
      db.transact(db.tx.customFields[field.id].delete());
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`border rounded-lg p-4 bg-background transition-colors cursor-grab active:cursor-grabbing ${
        isDragOver ? "border-accent/50 bg-accent/5" : "border-border"
      }`}
    >
      {/* Top row: drag handle, label, type, required, delete */}
      <div className="flex items-center gap-3">
        <span className="text-muted select-none text-lg flex-shrink-0">&#x2630;</span>

        <div className="flex-1 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">{t("admin.fieldLabel")} *</label>
            <input
              value={field.label}
              onChange={(e) => updateField({ label: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder="e.g., Promotor"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">{t("admin.fieldType")} *</label>
            <select
              value={field.fieldType}
              onChange={(e) => {
                const newType = e.target.value;
                const willHaveOptions = newType === "select" || newType === "multiselect";
                updateField({
                  fieldType: newType,
                  ...(willHaveOptions && parsedOptions.length === 0
                    ? { options: JSON.stringify([""]) }
                    : !willHaveOptions
                      ? { options: undefined }
                      : {}),
                });
              }}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            >
              {FIELD_TYPE_VALUES.map((ft) => (
                <option key={ft} value={ft}>{getFieldTypeLabel(ft, lang)}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-1.5 cursor-pointer flex-shrink-0 text-sm">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => updateField({ required: e.target.checked })}
            className="accent-accent-light"
          />
          <span className="text-xs whitespace-nowrap">{t("admin.requiredField")}</span>
        </label>

        <button
          onClick={deleteField}
          className="flex-shrink-0 p-1.5 bg-danger/90 hover:bg-danger text-white rounded-md transition-colors"
          title={t("common.delete")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Options section for select/multiselect */}
      {hasOptions && (
        <div className="mt-4 ml-8">
          <label className="block text-xs text-muted mb-2">
            {field.fieldType === "select" ? t("admin.selectOptions") : t("admin.multiselectOptions")} ({t("common.optional")})
          </label>
          <div className="space-y-2">
            {parsedOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                  className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder={t("admin.optionLabel", { n: i + 1 })}
                />
                <button
                  onClick={() => removeOption(i)}
                  className="flex-shrink-0 p-1.5 bg-danger/90 hover:bg-danger text-white rounded-md transition-colors"
                  title={t("common.delete")}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addOption}
            className="mt-2 w-full py-2 border-2 border-dashed border-border hover:border-accent/40 text-muted hover:text-accent-light rounded-lg text-sm font-medium transition-colors"
          >
            {t("admin.addOption")}
          </button>
        </div>
      )}
    </div>
  );
}

function CustomFieldsSection({
  concertId,
  customFields,
}: {
  concertId: string;
  customFields: CustomFieldData[];
}) {
  const { t } = useLanguage();
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function addField() {
    const maxSort = customFields.reduce((max, f) => Math.max(max, f.sortOrder), -1);
    db.transact(
      db.tx.customFields[id()]
        .update({
          label: "",
          fieldType: "text",
          required: false,
          sortOrder: maxSort + 1,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );
  }

  function handleDragStart(e: React.DragEvent, fieldId: string) {
    e.dataTransfer.setData("text/plain", fieldId);
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    const sourceId = e.dataTransfer.getData("text/plain");
    if (sourceId === targetId) return;
    const sorted = [...customFields].sort((a, b) => a.sortOrder - b.sortOrder);
    const sourceIdx = sorted.findIndex((f) => f.id === sourceId);
    const targetIdx = sorted.findIndex((f) => f.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    db.transact(reordered.map((f, i) => db.tx.customFields[f.id].update({ sortOrder: i })));
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold">{t("admin.customFields")}</h2>
      </div>
      <p className="text-sm text-muted mb-4">
        {t("admin.customFieldsSub")}
      </p>

      <div className="space-y-3">
        {customFields.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            {t("admin.noCustomFields")}
          </p>
        ) : (
          [...customFields]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((f) => (
              <CustomFieldCard
                key={f.id}
                field={f}
                onDragStart={(e) => handleDragStart(e, f.id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverId(f.id); }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => handleDrop(e, f.id)}
                isDragOver={dragOverId === f.id}
              />
            ))
        )}
      </div>

      <button
        onClick={addField}
        className="mt-4 w-full py-2.5 border-2 border-dashed border-border hover:border-accent/40 text-muted hover:text-accent-light rounded-lg text-sm font-medium transition-colors"
      >
        {t("admin.addField")}
      </button>
    </div>
  );
}

function ScannerPinSection({
  concertId,
  currentPin,
}: {
  concertId: string;
  currentPin?: string;
}) {
  const { t } = useLanguage();
  const [pin, setPin] = useState(currentPin || "");
  const [saved, setSaved] = useState(false);

  function generatePin() {
    const random = Math.floor(1000 + Math.random() * 9000).toString();
    setPin(random);
  }

  function handleSave() {
    if (pin && (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin))) return;
    db.transact(
      db.tx.concerts[concertId].update({ scannerPin: pin || "" }),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClear() {
    setPin("");
    db.transact(
      db.tx.concerts[concertId].update({ scannerPin: "" }),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-lg font-semibold mb-4">{t("admin.doorScannerPin")}</h2>
      <p className="text-sm text-muted mb-4">
        {t("admin.sharePinDesc")}{" "}
        <code className="text-accent-light">/scan</code>.
      </p>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder={t("admin.pinPlaceholder")}
          className="flex-1 px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-center font-mono text-xl tracking-[0.3em]"
        />
        <button
          onClick={generatePin}
          className="px-3 py-2.5 border border-border rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium"
        >
          {t("admin.generatePin")}
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!pin || pin.length < 4}
          className="flex-1 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
        >
          {saved ? t("common.saved") : t("admin.savePIN")}
        </button>
        {currentPin && (
          <button
            onClick={handleClear}
            className="px-4 py-2.5 border border-danger/30 text-danger rounded-lg hover:bg-danger/10 transition-colors text-sm font-medium"
          >
            {t("admin.clearPIN")}
          </button>
        )}
      </div>
    </div>
  );
}

function BrandingSection({
  concertId,
  flyerUrl,
  logoUrl,
  primaryColor,
}: {
  concertId: string;
  flyerUrl?: string;
  logoUrl?: string;
  primaryColor?: string;
}) {
  const { t } = useLanguage();
  const [uploadingFlyer, setUploadingFlyer] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const flyerInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function handleFlyerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFlyer(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `event-assets/${concertId}/flyer.${ext}`;
      await db.storage.upload(path, file);

      // Query for the uploaded file to get its CDN URL
      const { data: { $files } } = await db.queryOnce({ $files: { $: { where: { path } } } });
      const uploadedUrl = $files[0]?.url;
      if (!uploadedUrl) {
        setUploadingFlyer(false);
        return;
      }

      // Extract dominant color from the flyer
      let color: string | undefined;
      try {
        color = await extractDominantColor(uploadedUrl);
      } catch {
        // Color extraction failed — proceed without it
      }

      await db.transact(
        db.tx.concerts[concertId].update({
          flyerUrl: uploadedUrl,
          ...(color ? { primaryColor: color } : {}),
        }),
      );
    } catch (err) {
      console.error("Flyer upload failed:", err);
    }
    setUploadingFlyer(false);
    if (flyerInputRef.current) flyerInputRef.current.value = "";
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `event-assets/${concertId}/logo.${ext}`;
      await db.storage.upload(path, file);

      const { data: { $files } } = await db.queryOnce({ $files: { $: { where: { path } } } });
      const uploadedUrl = $files[0]?.url;
      if (!uploadedUrl) {
        setUploadingLogo(false);
        return;
      }

      await db.transact(
        db.tx.concerts[concertId].update({ logoUrl: uploadedUrl }),
      );
    } catch (err) {
      console.error("Logo upload failed:", err);
    }
    setUploadingLogo(false);
    if (logoInputRef.current) logoInputRef.current.value = "";
  }

  function removeFlyer() {
    db.transact(
      db.tx.concerts[concertId].update({
        flyerUrl: "",
        primaryColor: "",
      }),
    );
  }

  function removeLogo() {
    db.transact(
      db.tx.concerts[concertId].update({ logoUrl: "" }),
    );
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-6">
      <h2 className="text-lg font-bold mb-4">{t("admin.branding")}</h2>

      {/* Flyer */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">{t("admin.flyer")}</label>
        {flyerUrl ? (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden border border-border">
              <img
                src={flyerUrl}
                alt={t("admin.flyer")}
                className="w-full h-48 object-cover"
              />
            </div>
            {primaryColor && (
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-full border border-border"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className="text-sm text-muted font-mono">
                  {primaryColor}
                </span>
                <span className="text-xs text-muted">{t("admin.autoExtractedColor")}</span>
              </div>
            )}
            <button
              onClick={removeFlyer}
              className="text-sm text-danger hover:text-danger/80 transition-colors"
            >
              {t("admin.removeFlyer")}
            </button>
          </div>
        ) : (
          <div>
            <input
              ref={flyerInputRef}
              type="file"
              accept="image/*"
              onChange={handleFlyerUpload}
              disabled={uploadingFlyer}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg text-sm file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-accent/20 file:text-accent-light file:font-medium file:cursor-pointer"
            />
            {uploadingFlyer && (
              <p className="text-sm text-muted mt-1 animate-pulse">
                {t("admin.uploadingFlyer")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Logo */}
      <div>
        <label className="block text-sm font-medium mb-2">{t("admin.logo")}</label>
        {logoUrl ? (
          <div className="space-y-3">
            <div className="inline-block rounded-xl overflow-hidden border border-border bg-background p-2">
              <img
                src={logoUrl}
                alt={t("admin.logo")}
                className="h-16 w-auto object-contain"
              />
            </div>
            <div>
              <button
                onClick={removeLogo}
                className="text-sm text-danger hover:text-danger/80 transition-colors"
              >
                {t("admin.removeLogo")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              disabled={uploadingLogo}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg text-sm file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-accent/20 file:text-accent-light file:font-medium file:cursor-pointer"
            />
            {uploadingLogo && (
              <p className="text-sm text-muted mt-1 animate-pulse">
                {t("admin.uploadingLogo")}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlatformFeeSection({
  concertId,
  feeConfig,
  isSuperAdmin,
}: {
  concertId: string;
  feeConfig: { id: string; feePercent: number; feeFixed: number; billingMode: string } | undefined;
  isSuperAdmin: boolean;
}) {
  const { t } = useLanguage();
  const [feePercent, setFeePercent] = useState(feeConfig?.feePercent?.toString() || "5");
  const [feeFixed, setFeeFixed] = useState(feeConfig?.feeFixed?.toString() || "0");
  const [billingMode, setBillingMode] = useState(feeConfig?.billingMode || "prepaid");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Preview calculation
  const previewPrice = 10;
  const pPercent = parseFloat(feePercent) || 0;
  const pFixed = parseFloat(feeFixed) || 0;
  const calculatedFee = previewPrice * (pPercent / 100) + pFixed;

  async function handleSave() {
    setSaving(true);
    try {
      const data = {
        feePercent: parseFloat(feePercent) || 0,
        feeFixed: parseFloat(feeFixed) || 0,
        billingMode,
        updatedAt: Date.now(),
      };

      if (feeConfig) {
        await db.transact([db.tx.platformFeeConfigs[feeConfig.id].update(data)]);
      } else {
        const newId = id();
        await db.transact([
          db.tx.platformFeeConfigs[newId].update(data).link({ concert: concertId }),
        ]);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save fee config:", err);
      alert("Error saving fee config");
    } finally {
      setSaving(false);
    }
  }

  // Read-only view for organizers
  if (!isSuperAdmin) {
    if (!feeConfig) return null;
    return (
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4">{t("admin.platformFeeConfig")}</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-muted">{t("admin.pFeePercent")}</p>
            <p className="text-lg font-semibold">{feeConfig.feePercent}%</p>
          </div>
          <div>
            <p className="text-sm text-muted">{t("admin.pFeeFixed")}</p>
            <p className="text-lg font-semibold">${feeConfig.feeFixed.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-muted">{t("admin.billingMode")}</p>
            <p className="text-lg font-semibold">
              {t(feeConfig.billingMode === "postpaid" ? "admin.postpaid" : "admin.prepaid")}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted mt-3">
          {t("admin.pFeePreview", {
            price: previewPrice.toFixed(2),
            fee: (feeConfig.feePercent / 100 * previewPrice + feeConfig.feeFixed).toFixed(2),
          })}
        </p>
      </div>
    );
  }

  // Editable view for super admin
  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-lg font-bold mb-4">{t("admin.platformFeeConfig")}</h2>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("admin.pFeePercent")}
          </label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("admin.pFeeFixed")}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={feeFixed}
            onChange={(e) => setFeeFixed(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30"
          />
        </div>
      </div>
      <p className="text-sm text-muted mb-4">
        {t("admin.pFeePreview", {
          price: previewPrice.toFixed(2),
          fee: calculatedFee.toFixed(2),
        })}
      </p>
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1.5">
          {t("admin.billingMode")}
        </label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setBillingMode("prepaid")}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              billingMode === "prepaid"
                ? "bg-accent/10 border-accent text-accent"
                : "bg-background border-border text-muted hover:border-accent-light"
            }`}
          >
            <div>{t("admin.prepaid")}</div>
            <div className="text-xs font-normal mt-0.5 opacity-70">{t("admin.prepaidDesc")}</div>
          </button>
          <button
            type="button"
            onClick={() => setBillingMode("postpaid")}
            className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              billingMode === "postpaid"
                ? "bg-warning/10 border-warning text-warning"
                : "bg-background border-border text-muted hover:border-warning"
            }`}
          >
            <div>{t("admin.postpaid")}</div>
            <div className="text-xs font-normal mt-0.5 opacity-70">{t("admin.postpaidDesc")}</div>
          </button>
        </div>
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
      >
        {saving ? "..." : saved ? t("common.saved") : t("common.saveChanges")}
      </button>
    </div>
  );
}
