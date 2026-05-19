"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { useStorageUrl } from "@/lib/useStorageUrl";
import { extractDominantColor, extractPalette, mapPaletteToTheme } from "@/lib/colorExtract";
import { serializeThemeColors } from "@/lib/themeColors";
import PaletteEditor from "@/components/admin/PaletteEditor";
import { getFieldTypeLabel } from "@/lib/i18n";
import { id as genId } from "@instantdb/react";
import { toast } from "sonner";
import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseRows, type ParsedEntry, type ParseResult } from "@/lib/guestListCsvParser";
import { getTodayString } from "@/lib/phases";

const BASE_METHODS = [
  { type: "efectivo", name: "Efectivo" },
  { type: "zelle", name: "Zelle" },
  { type: "pago_movil", name: "Pago Móvil" },
] as const;

const FIELD_TYPE_VALUES = [
  "text",
  "number",
  "checkbox",
  "date",
  "email",
  "select",
  "multiselect",
] as const;

type Entry = {
  id: string;
  email?: string;
  cedula?: string;
  firstName?: string;
  lastName?: string;
  priceOverride?: number;
  status: string;
  inviteSentAt?: number;
  registeredAt?: number;
  inviteToken?: string;
  order?: { id: string; status: string; orderNumber?: string }[] | { id: string; status: string; orderNumber?: string };
  ticketType?: { id: string; name: string }[] | { id: string; name: string };
};

function getEntryTicketType(entry: Entry) {
  const raw = entry.ticketType;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function getOrder(entry: Entry) {
  const raw = entry.order;
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export default function AdminGuestListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: eventId } = use(params);
  const { email, isSuperAdmin } = useAuthContext();
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";
  const { t } = useLanguage();
  const router = useRouter();
  const [tab, setTab] = useState<"entries" | "orders">("entries");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "invited" | "registered" | "revoked">("all");
  const [showUpload, setShowUpload] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);

  const { isLoading, data } = db.useQuery({
    guestListEvents: {
      $: { where: { id: eventId } },
      entries: {
        $: { order: { createdAt: "desc" as const } },
        order: {},
        ticketType: {},
      },
      paymentMethods: {
        $: { order: { sortOrder: "asc" as const } },
      },
      customFields: {
        $: { order: { sortOrder: "asc" as const } },
      },
      collaborators: {},
      ticketTypes: {
        $: { order: { sortOrder: "asc" as const } },
        entries: {},
        orders: {},
      },
      platformFeeConfig: {},
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }
  const event = data.guestListEvents[0];
  if (!event) {
    return (
      <div className="text-center py-12">
        <p className="text-muted">{t("guestList.notFound")}</p>
        <Link href="/admin/guest-lists" className="text-accent-light underline mt-3 inline-block">
          {t("common.back")}
        </Link>
      </div>
    );
  }
  const isOwner = isSuperAdmin || event.organizerEmail === email;
  if (!isOwner) {
    return <div className="text-muted">{t("common.forbidden")}</div>;
  }

  const entries = (event.entries || []) as unknown as Entry[];
  const totalInvited = entries.filter((e) => e.status === "invited").length;
  const totalRegistered = entries.filter((e) => e.status === "registered").length;
  const totalRevoked = entries.filter((e) => e.status === "revoked").length;

  let revenue = 0;
  let pendingOrders = 0;
  let approvedOrders = 0;
  let visitedCount = 0;
  let outstandingPending = 0;
  for (const e of entries) {
    const o = getOrder(e) as
      | { status: string; pricePaid: number; visited: boolean }
      | undefined;
    if (!o) continue;
    if (o.status === "approved") {
      approvedOrders++;
      revenue += o.pricePaid || 0;
      if (o.visited) visitedCount++;
    } else if (o.status === "pending") {
      pendingOrders++;
      outstandingPending += o.pricePaid || 0;
    }
  }
  const filtered = entries.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const blob = `${e.email || ""} ${e.cedula || ""} ${e.firstName || ""} ${e.lastName || ""}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });

  function updateField(field: string, value: unknown) {
    const updates: Record<string, unknown> = { [field]: value };
    db.transact(db.tx.guestListEvents[eventId].update(updates));
  }

  function toggleStatus() {
    const newStatus = event.status === "active" ? "draft" : "active";
    db.transact(db.tx.guestListEvents[eventId].update({ status: newStatus }));
  }

  function finalizeEvent() {
    const isPast = event.date < getTodayString();
    const message = isPast
      ? t("admin.markFinalizedConfirm")
      : t("admin.markFinalizedFutureWarning", { date: event.date });
    if (!confirm(message)) return;
    db.transact(
      db.tx.guestListEvents[eventId].update({
        status: "finalized",
        finalizedAt: Date.now(),
      }),
    );
  }

  function reopenEvent() {
    if (!confirm(t("admin.reopenEventConfirm"))) return;
    db.transact(
      db.tx.guestListEvents[eventId].update({
        status: "active",
        finalizedAt: undefined,
      }),
    );
  }

  function formatFinalizedAt(ts: number | undefined): string {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  const isFinalized = event.status === "finalized";

  async function sendInvites(mode: "all" | "pending") {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/guest-list/send-invites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ eventId, mode }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSendResult(t("guestList.sendError") + ": " + (body.error || "?"));
      } else {
        setSendResult(
          t("guestList.sendDone", {
            invites: body.invitesSent ?? 0,
            tickets: body.ticketsSent ?? 0,
            failed: body.failed,
            suppressed: body.suppressed,
          }),
        );
      }
    } catch (err) {
      setSendResult(String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/guest-lists" className="text-sm text-accent-light hover:underline">
            ← {t("common.back")}
          </Link>
          <h1 className="text-3xl font-bold mt-2">{event.name}</h1>
          <p className="text-sm text-muted">{event.date} {event.venue ? `· ${event.venue}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {isFinalized ? (
            <span className="px-3 py-1.5 rounded-full text-xs font-medium border bg-blue-100 text-blue-800 border-blue-300">
              {t("common.finalized")}
            </span>
          ) : (
            <button
              onClick={toggleStatus}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                event.status === "active"
                  ? "bg-success/10 text-success border-success/30 hover:bg-success/20"
                  : "bg-muted/10 text-muted border-muted/30 hover:bg-muted/20"
              }`}
            >
              {event.status === "active" ? t("common.active") : t("common.draft")}
            </button>
          )}
          {event.scannerPin && (
            <Link
              href={`/scan/guest-list/${event.id}`}
              className="px-3 py-1.5 rounded-full text-xs font-medium border bg-accent/10 text-accent-light border-accent/30 hover:bg-accent/20"
            >
              {t("guestList.openScanner")}
            </Link>
          )}
        </div>
      </div>

      <EventForm event={event} onUpdate={updateField} t={t} />

      <TicketTypesSection
        eventId={eventId}
        ticketTypes={(event.ticketTypes || []) as TicketType[]}
        defaultPrice={event.defaultPrice}
        t={t}
      />

      <FeesSection
        ticketTypes={(event.ticketTypes || []) as TicketType[]}
        t={t}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <BrandingSection
          eventId={eventId}
          flyerPath={event.flyerPath}
          logoPath={event.logoPath}
          primaryColor={event.primaryColor}
          themeColors={event.themeColors}
          paletteRefPath={event.paletteRefPath}
          t={t}
        />
        <PaymentMethodsSection
          eventId={eventId}
          methods={(event.paymentMethods || []) as PaymentMethod[]}
          t={t}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <CustomFieldsSection
          eventId={eventId}
          fields={(event.customFields || []) as CustomField[]}
          t={t}
        />
        <CollaboratorsSection
          eventId={eventId}
          collaborators={(event.collaborators || []) as Collaborator[]}
          ownerEmail={email}
          isPrimaryOwner={event.organizerEmail === email}
          t={t}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t("guestList.statTotal")} value={entries.length} />
        <Stat label={t("guestList.statInvited")} value={totalInvited} accent="text-accent-light" />
        <Stat label={t("guestList.statRegistered")} value={totalRegistered} accent="text-success" />
        <Stat label={t("guestList.statRevoked")} value={totalRevoked} accent="text-muted" />
      </div>

      <div className="flex border-b border-border">
        <TabButton active={tab === "entries"} onClick={() => setTab("entries")}>
          {t("guestList.tabEntries")} ({entries.length})
        </TabButton>
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")}>
          {t("guestList.tabOrders")} ({totalRegistered})
        </TabButton>
      </div>

      {tab === "entries" && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowUpload(true)}
              className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium"
            >
              {t("guestList.uploadCsv")}
            </button>
            <button
              onClick={() => setShowManual(true)}
              className="px-4 py-2 bg-surface border border-border hover:border-accent/50 rounded-lg text-sm font-medium"
            >
              {t("guestList.addManual")}
            </button>
            <button
              onClick={() => sendInvites("pending")}
              disabled={sending || totalInvited === 0}
              className="px-4 py-2 bg-surface border border-border hover:border-accent/50 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {sending ? t("common.loading") : t("guestList.sendPending")}
            </button>
            <button
              onClick={() => sendInvites("all")}
              disabled={sending || totalInvited === 0}
              className="px-4 py-2 bg-surface border border-border hover:border-accent/50 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {t("guestList.resendAll")}
            </button>
          </div>
          {sendResult && <p className="text-sm text-muted">{sendResult}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder={t("guestList.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light"
            >
              <option value="all">{t("guestList.filterAll")}</option>
              <option value="invited">{t("guestList.statInvited")}</option>
              <option value="registered">{t("guestList.statRegistered")}</option>
              <option value="revoked">{t("guestList.statRevoked")}</option>
            </select>
          </div>

          <EntriesTable
            entries={filtered}
            defaultPrice={event.defaultPrice}
            ticketTypes={(event.ticketTypes || []) as TicketType[]}
            refreshToken={refreshToken}
            t={t}
          />
        </>
      )}

      {tab === "orders" && (
        <div className="bg-surface border border-border rounded-xl p-8 text-center space-y-4">
          <p className="text-muted">{t("guestList.ordersTabHint")}</p>
          <Link
            href={`/admin/orders/guest-list/${eventId}`}
            className="inline-block px-5 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-semibold"
          >
            {t("guestList.openOrders")}
          </Link>
        </div>
      )}

      {showUpload && (
        <UploadModal
          eventId={eventId}
          refreshToken={refreshToken}
          ticketTypes={(event.ticketTypes || []) as TicketType[]}
          onClose={() => setShowUpload(false)}
          t={t}
        />
      )}
      {showManual && (
        <ManualEntryModal
          eventId={eventId}
          refreshToken={refreshToken}
          ticketTypes={(event.ticketTypes || []) as TicketType[]}
          onClose={() => setShowManual(false)}
          t={t}
        />
      )}

      <PlatformFeeSection
        eventId={eventId}
        feeConfig={
          event.platformFeeConfig as
            | { id: string; feePercent: number; feeFixed: number; billingMode: string }
            | undefined
        }
        isSuperAdmin={isSuperAdmin}
        isDemo={!!event.isDemo}
        t={t}
      />

      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-muted mb-3">
          {t("admin.finalizationTitle")}
        </h3>
        {isFinalized ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="inline-flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-300">
                  {t("common.finalized")}
                </span>
                {event.finalizedAt && (
                  <span className="text-muted">
                    {t("admin.finalizedOn", { date: formatFinalizedAt(event.finalizedAt) })}
                  </span>
                )}
              </span>
            </div>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={reopenEvent}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:border-accent/50 text-muted hover:text-accent-light transition-colors"
              >
                {t("admin.reopenEvent")}
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={finalizeEvent}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors"
          >
            {t("admin.markFinalized")}
          </button>
        )}
      </div>

      <DangerZone onDelete={() => setShowDelete(true)} t={t} />

      {showDelete && (
        <DeleteEventModal
          eventId={eventId}
          eventName={event.name}
          entriesCount={entries.length}
          approvedCount={approvedOrders}
          onClose={() => setShowDelete(false)}
          onDeleted={() => router.push("/admin/guest-lists")}
          t={t}
        />
      )}
    </div>
  );
}

type PaymentMethod = {
  id: string;
  type?: string;
  name: string;
  instructions?: string;
  convertCurrency?: string;
  requireScreenshot?: boolean;
  requireReferenceNumber?: boolean;
  showConversionDetail?: boolean;
  customRate?: number;
  zelleEmail?: string;
  zelleName?: string;
  pmCedula?: string;
  pmPhone?: string;
  pmBank?: string;
  discountType?: string;
  discountValue?: number;
};

type CustomField = {
  id: string;
  label: string;
  fieldType: string;
  required: boolean;
  options?: string;
  sortOrder: number;
};

type Collaborator = {
  id: string;
  email: string;
  invitedAt: number;
  invitedByEmail: string;
};

type TicketType = {
  id: string;
  name: string;
  price: number;
  quantity?: number;
  description?: string;
  feePercent?: number;
  feeFixed?: number;
  sortOrder: number;
  entries?: { id: string; status: string }[];
  orders?: { id: string; status: string }[];
};

function TicketTypesSection({
  eventId,
  ticketTypes,
  defaultPrice,
  t,
}: {
  eventId: string;
  ticketTypes: TicketType[];
  defaultPrice: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [description, setDescription] = useState("");
  const sorted = [...ticketTypes].sort((a, b) => a.sortOrder - b.sortOrder);

  // Auto-create a default "General" ticket type if none exists
  if (ticketTypes.length === 0) {
    setTimeout(() => {
      db.transact(
        db.tx.guestListTicketTypes[genId()]
          .update({
            name: "General",
            price: defaultPrice ?? 0,
            sortOrder: 0,
            createdAt: Date.now(),
          })
          .link({ event: eventId }),
      );
    }, 0);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const parsedPrice = parseFloat(price);
    const parsedQty = quantity ? parseInt(quantity, 10) : undefined;
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) return;
    if (parsedQty !== undefined && (!Number.isFinite(parsedQty) || parsedQty < 1)) return;
    const maxSort = sorted.reduce((m, tt) => Math.max(m, tt.sortOrder), -1);
    db.transact(
      db.tx.guestListTicketTypes[genId()]
        .update({
          name,
          price: parsedPrice,
          ...(parsedQty !== undefined ? { quantity: parsedQty } : {}),
          ...(description ? { description } : {}),
          sortOrder: maxSort + 1,
          createdAt: Date.now(),
        })
        .link({ event: eventId }),
    );
    setName("");
    setPrice("");
    setQuantity("");
    setDescription("");
    setShowForm(false);
  }

  function deleteTicketType(ttId: string) {
    if (confirm(t("guestList.ttDeleteConfirm"))) {
      db.transact(db.tx.guestListTicketTypes[ttId].delete());
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

      <p className="text-sm text-muted mb-4">{t("guestList.ttHelp")}</p>

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
                {t("common.quantity")} <span className="text-muted font-normal">({t("common.optional")})</span>
              </label>
              <input
                type="number"
                min="1"
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
        {sorted.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            {t("admin.noTicketTypes")}
          </p>
        ) : (
          sorted.map((tt) => {
            const sold = (tt.orders || []).filter(
              (o) => o.status === "approved" || o.status === "pending",
            ).length;
            const totalEntries = (tt.entries || []).length;
            return (
              <GuestListTicketTypeItem
                key={tt.id}
                tt={tt}
                sold={sold}
                totalEntries={totalEntries}
                onDelete={() => deleteTicketType(tt.id)}
                t={t}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function GuestListTicketTypeItem({
  tt,
  sold,
  totalEntries,
  onDelete,
  t,
}: {
  tt: TicketType;
  sold: number;
  totalEntries: number;
  onDelete: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="border border-border rounded-lg">
      <div className="flex items-center justify-between p-4">
        <div className="flex-1 min-w-0">
          <input
            value={tt.name}
            onChange={(e) =>
              db.transact(
                db.tx.guestListTicketTypes[tt.id].update({ name: e.target.value }),
              )
            }
            className="font-medium text-base text-foreground font-sans bg-transparent border-b border-transparent hover:border-border focus:border-accent-light focus:outline-none transition-colors py-0 px-0 field-sizing-content"
          />
          <input
            value={tt.description || ""}
            onChange={(e) =>
              db.transact(
                db.tx.guestListTicketTypes[tt.id].update({
                  description: e.target.value || undefined,
                }),
              )
            }
            placeholder={t("admin.addDescription")}
            className="text-sm text-muted bg-transparent border-b border-transparent hover:border-border focus:border-accent-light focus:outline-none w-full transition-colors py-0.5"
          />
          <p className="text-sm text-muted mt-1">
            ${tt.price.toFixed(2)}
            {" · "}
            {totalEntries > 0
              ? t("guestList.ttEntriesCount", { count: totalEntries })
              : t("guestList.ttNoEntries")}
            {tt.quantity != null && ` · ${t("admin.soldCount", { sold, total: tt.quantity })}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={tt.price}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) {
                  db.transact(
                    db.tx.guestListTicketTypes[tt.id].update({ price: v }),
                  );
                }
              }}
              className="w-20 px-2 py-1 bg-background border border-border rounded text-sm"
            />
          </div>
          <input
            type="number"
            min="1"
            placeholder="∞"
            value={tt.quantity ?? ""}
            onChange={(e) => {
              if (e.target.value === "") {
                db.transact(
                  db.tx.guestListTicketTypes[tt.id].update({ quantity: null }),
                );
              } else {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v >= 1) {
                  db.transact(
                    db.tx.guestListTicketTypes[tt.id].update({ quantity: v }),
                  );
                }
              }
            }}
            className="w-16 px-2 py-1 bg-background border border-border rounded text-sm text-center"
            title={t("guestList.ttQuantityHint")}
          />
          <button
            onClick={onDelete}
            className="text-muted hover:text-danger transition-colors text-sm ml-2"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

function BrandingSection({
  eventId,
  flyerPath,
  logoPath,
  primaryColor,
  themeColors,
  paletteRefPath,
  t,
}: {
  eventId: string;
  flyerPath?: string;
  logoPath?: string;
  primaryColor?: string;
  themeColors?: string;
  paletteRefPath?: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [uploadingFlyer, setUploadingFlyer] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPaletteRef, setUploadingPaletteRef] = useState(false);
  const [generatingPalette, setGeneratingPalette] = useState(false);
  const flyerInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const flyerUrl = useStorageUrl(flyerPath);
  const logoUrl = useStorageUrl(logoPath);

  async function deleteOldFiles(prefix: string) {
    try {
      const { data: { $files: oldFiles } } = await db.queryOnce({
        $files: { $: { where: { path: { $like: prefix } } } },
      });
      if (oldFiles.length > 0) {
        await db.transact(oldFiles.map((f) => db.tx.$files[f.id].delete()));
      }
    } catch {
      /* ignore */
    }
  }

  async function handlePaletteRefUpload(file: File) {
    setUploadingPaletteRef(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `event-assets/${eventId}/palette-ref.${ext}`;
      await deleteOldFiles(`event-assets/${eventId}/palette-ref%`);
      await db.storage.upload(path, file);
      const { data: { $files } } = await db.queryOnce({
        $files: { $: { where: { path } } },
      });
      const uploadedUrl = $files[0]?.url;
      await db.transact(
        db.tx.guestListEvents[eventId].update({
          paletteRefPath: path,
          paletteRefUrl: uploadedUrl || "",
        }),
      );
    } catch (err) {
      console.error("Palette ref upload failed:", err);
    }
    setUploadingPaletteRef(false);
  }

  async function handleRemovePaletteRef() {
    await deleteOldFiles(`event-assets/${eventId}/palette-ref%`);
    db.transact(
      db.tx.guestListEvents[eventId].update({
        paletteRefPath: "",
        paletteRefUrl: "",
      }),
    );
  }

  async function handleGeneratePalette(refUrl: string) {
    setGeneratingPalette(true);
    try {
      const colors = await extractPalette(refUrl, 6);
      const theme = mapPaletteToTheme(colors);
      await db.transact(
        db.tx.guestListEvents[eventId].update({ themeColors: serializeThemeColors(theme) }),
      );
    } catch (err) {
      console.error("Palette generation failed:", err);
    }
    setGeneratingPalette(false);
  }

  function handleChangeThemeColors(json: string) {
    db.transact(db.tx.guestListEvents[eventId].update({ themeColors: json }));
  }

  async function handleFlyerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFlyer(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `event-assets/${eventId}/flyer.${ext}`;
      await deleteOldFiles(`event-assets/${eventId}/flyer%`);
      await db.storage.upload(path, file);
      const { data: { $files } } = await db.queryOnce({
        $files: { $: { where: { path } } },
      });
      const uploadedUrl = $files[0]?.url;
      if (!uploadedUrl) {
        setUploadingFlyer(false);
        return;
      }
      let color: string | undefined;
      try {
        color = await extractDominantColor(uploadedUrl);
      } catch {
        /* ignore */
      }
      await db.transact(
        db.tx.guestListEvents[eventId].update({
          flyerPath: path,
          flyerUrl: "",
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
      const path = `event-assets/${eventId}/logo.${ext}`;
      await deleteOldFiles(`event-assets/${eventId}/logo%`);
      await db.storage.upload(path, file);
      await db.transact(
        db.tx.guestListEvents[eventId].update({ logoPath: path, logoUrl: "" }),
      );
    } catch (err) {
      console.error("Logo upload failed:", err);
    }
    setUploadingLogo(false);
    if (logoInputRef.current) logoInputRef.current.value = "";
  }

  async function removeFlyer() {
    await deleteOldFiles(`event-assets/${eventId}/flyer%`);
    db.transact(
      db.tx.guestListEvents[eventId].update({
        flyerPath: "",
        flyerUrl: "",
      }),
    );
  }

  async function removeLogo() {
    await deleteOldFiles(`event-assets/${eventId}/logo%`);
    db.transact(
      db.tx.guestListEvents[eventId].update({ logoPath: "", logoUrl: "" }),
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold mb-4">{t("guestList.brandingTitle")}</h3>
      <div className="mb-5">
        <label className="block text-xs font-medium text-muted uppercase mb-2">
          {t("guestList.flyer")}
        </label>
        {flyerPath ? (
          <div className="space-y-2">
            <div className="rounded-lg overflow-hidden border border-border">
              {flyerUrl && (
                <img src={flyerUrl} alt="flyer" className="w-full h-40 object-cover" />
              )}
            </div>
            {primaryColor && (
              <div className="flex items-center gap-2">
                <div
                  className="w-5 h-5 rounded-full border border-border"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className="text-xs font-mono text-muted">{primaryColor}</span>
              </div>
            )}
            <button
              onClick={removeFlyer}
              className="text-xs text-danger hover:text-danger/80"
            >
              {t("guestList.removeFlyer")}
            </button>
          </div>
        ) : (
          <input
            ref={flyerInputRef}
            type="file"
            accept="image/*"
            onChange={handleFlyerUpload}
            disabled={uploadingFlyer}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-accent/20 file:text-accent-light file:font-medium file:cursor-pointer"
          />
        )}
        {uploadingFlyer && (
          <p className="text-xs text-muted mt-1 animate-pulse">{t("common.loading")}</p>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-muted uppercase mb-2">
          {t("guestList.logo")}
        </label>
        {logoPath ? (
          <div className="space-y-2">
            <div className="inline-block rounded-lg overflow-hidden border border-border bg-background p-2">
              {logoUrl && (
                <img src={logoUrl} alt="logo" className="h-12 w-auto object-contain" />
              )}
            </div>
            <div>
              <button
                onClick={removeLogo}
                className="text-xs text-danger hover:text-danger/80"
              >
                {t("guestList.removeLogo")}
              </button>
            </div>
          </div>
        ) : (
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={handleLogoUpload}
            disabled={uploadingLogo}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-accent/20 file:text-accent-light file:font-medium file:cursor-pointer"
          />
        )}
        {uploadingLogo && (
          <p className="text-xs text-muted mt-1 animate-pulse">{t("common.loading")}</p>
        )}
      </div>

      <PaletteEditor
        themeColors={themeColors}
        paletteRefPath={paletteRefPath}
        primaryColor={primaryColor}
        uploadingRef={uploadingPaletteRef}
        generating={generatingPalette}
        onChangeThemeColors={handleChangeThemeColors}
        onUploadRef={handlePaletteRefUpload}
        onRemoveRef={handleRemovePaletteRef}
        onGeneratePalette={handleGeneratePalette}
        t={t}
      />
    </div>
  );
}

function PaymentMethodCard({
  eventId,
  base,
  existing,
  t,
}: {
  eventId: string;
  base: (typeof BASE_METHODS)[number];
  existing: PaymentMethod | undefined;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [instructions, setInstructions] = useState(existing?.instructions || "");
  const [convertCurrency, setConvertCurrency] = useState(existing?.convertCurrency || "");
  const [requireScreenshot, setRequireScreenshot] = useState(existing?.requireScreenshot !== false);
  const [requireReferenceNumber, setRequireReferenceNumber] = useState(existing?.requireReferenceNumber === true);
  const [showConversionDetail, setShowConversionDetail] = useState(existing?.showConversionDetail !== false);
  const [rateMode, setRateMode] = useState<"USD" | "EUR" | "custom">(
    existing?.customRate ? "custom" : ((existing?.convertCurrency as "USD" | "EUR") || "USD"),
  );
  const [customRate, setCustomRate] = useState<string>(existing?.customRate ? String(existing.customRate) : "");
  const [customRateError, setCustomRateError] = useState<string>("");
  const [zelleEmail, setZelleEmail] = useState(existing?.zelleEmail || "");
  const [zelleName, setZelleName] = useState(existing?.zelleName || "");
  const [pmCedula, setPmCedula] = useState(existing?.pmCedula || "");
  const [pmPhone, setPmPhone] = useState(existing?.pmPhone || "");
  const [pmBank, setPmBank] = useState(existing?.pmBank || "");
  const [discountEnabled, setDiscountEnabled] = useState(
    !!existing?.discountType && !!existing?.discountValue && existing.discountValue > 0,
  );
  const [discountType, setDiscountType] = useState<"percentage" | "amount">(
    (existing?.discountType as "percentage" | "amount") || "percentage",
  );
  const [discountValue, setDiscountValue] = useState<string>(
    existing?.discountValue ? String(existing.discountValue) : "",
  );
  const [discountError, setDiscountError] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  const enabled = !!existing;

  function toggle() {
    if (enabled) {
      if (confirm(t("admin.disable", { name: base.name }))) {
        db.transact(db.tx.guestListPaymentMethods[existing!.id].delete());
      }
    } else {
      db.transact(
        db.tx.guestListPaymentMethods[genId()]
          .update({
            type: base.type,
            name: base.name,
            instructions: "",
            requireScreenshot: true,
            requireReferenceNumber: base.type !== "efectivo",
            sortOrder: 0,
            ...(base.type === "pago_movil" ? { convertCurrency: "USD" } : {}),
            createdAt: Date.now(),
          })
          .link({ event: eventId }),
      );
    }
  }

  function saveConfig() {
    if (!existing) return;
    const isCustom = base.type === "pago_movil" && rateMode === "custom";
    const parsedCustomRate = isCustom ? parseFloat(customRate) : NaN;
    if (isCustom && (!Number.isFinite(parsedCustomRate) || parsedCustomRate <= 0)) {
      setCustomRateError(t("admin.customRateInvalid"));
      return;
    }
    let parsedDiscountValue: number | null = null;
    if (discountEnabled) {
      const parsed = parseFloat(discountValue);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setDiscountError(t("admin.pmDiscountInvalid"));
        return;
      }
      if (discountType === "percentage" && parsed > 100) {
        setDiscountError(t("admin.pmDiscountInvalid"));
        return;
      }
      parsedDiscountValue = parsed;
    }
    const effectiveConvertCurrency = isCustom
      ? "USD"
      : base.type === "pago_movil"
        ? (convertCurrency || "USD")
        : (convertCurrency || "");
    if (base.type === "pago_movil" && !convertCurrency) {
      setConvertCurrency("USD");
    }
    db.transact(
      db.tx.guestListPaymentMethods[existing.id].update({
        instructions: instructions || "",
        convertCurrency: effectiveConvertCurrency,
        requireScreenshot,
        requireReferenceNumber: base.type === "efectivo" ? false : requireReferenceNumber,
        discountType: discountEnabled ? discountType : null,
        discountValue: parsedDiscountValue,
        ...(base.type === "zelle" ? { zelleEmail: zelleEmail || undefined, zelleName: zelleName || undefined } : {}),
        ...(base.type === "pago_movil" ? {
          pmCedula: pmCedula || undefined,
          pmPhone: pmPhone || undefined,
          pmBank: pmBank || undefined,
          showConversionDetail,
          customRate: isCustom ? parsedCustomRate : null,
        } : {}),
      }),
    );
    setDiscountError("");
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
            {base.type === "pago_movil" && existing?.convertCurrency && (
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
            {existing?.discountType && existing?.discountValue && existing.discountValue > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-accent-light/15 text-accent-light">
                {existing.discountType === "percentage"
                  ? `−${existing.discountValue}%`
                  : `−$${existing.discountValue.toFixed(2)}`}
              </span>
            )}
          </div>
        )}
      </div>

      {enabled && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {base.type === "zelle" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.zelleEmail")}</label>
                <input
                  value={zelleEmail}
                  onChange={(e) => { setZelleEmail(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder={t("admin.placeholders.email")}
                  type="email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.zelleName")}</label>
                <input
                  value={zelleName}
                  onChange={(e) => { setZelleName(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder={t("admin.placeholders.name")}
                />
              </div>
            </div>
          )}

          {base.type === "pago_movil" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.pmCedula")}</label>
                <input
                  value={pmCedula}
                  onChange={(e) => { setPmCedula(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder={t("admin.placeholders.cedula")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.pmPhone")}</label>
                <input
                  value={pmPhone}
                  onChange={(e) => { setPmPhone(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder={t("admin.placeholders.phone")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("admin.pmBank")}</label>
                <input
                  value={pmBank}
                  onChange={(e) => { setPmBank(e.target.value); setDirty(true); }}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  placeholder={t("admin.placeholders.bank")}
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
          {base.type === "pago_movil" && (
            <div>
              <label className="block text-sm font-medium mb-1">{t("admin.currencyConversion")}</label>
              <select
                value={rateMode}
                onChange={(e) => {
                  const next = e.target.value as "USD" | "EUR" | "custom";
                  setRateMode(next);
                  if (next === "custom") {
                    setConvertCurrency("USD");
                  } else {
                    setConvertCurrency(next);
                    setCustomRate("");
                    setCustomRateError("");
                  }
                  setDirty(true);
                }}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              >
                <option value="USD">USD &rarr; Bs</option>
                <option value="EUR">EUR &rarr; Bs</option>
                <option value="custom">{t("admin.currencyCustom")}</option>
              </select>
              {rateMode === "custom" && (
                <div className="mt-2">
                  <label className="block text-sm font-medium mb-1">{t("admin.customRateLabel")}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={customRate}
                    onChange={(e) => { setCustomRate(e.target.value); setCustomRateError(""); setDirty(true); }}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  />
                  {customRateError && (
                    <p className="text-xs text-danger mt-1">{customRateError}</p>
                  )}
                </div>
              )}
            </div>
          )}
          {base.type === "pago_movil" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showConversionDetail}
                onChange={(e) => { setShowConversionDetail(e.target.checked); setDirty(true); }}
                className="accent-accent-light"
              />
              <span className="text-sm">{t("admin.showConversionDetail")}</span>
            </label>
          )}
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
              {base.type !== "efectivo" && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireReferenceNumber}
                    onChange={(e) => { setRequireReferenceNumber(e.target.checked); setDirty(true); }}
                    className="accent-accent-light"
                  />
                  <span className="text-sm">{t("admin.requireRefNumber")}</span>
                </label>
              )}
            </div>
          </div>
          <div className="pt-3 border-t border-border">
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={discountEnabled}
                onChange={(e) => {
                  setDiscountEnabled(e.target.checked);
                  setDiscountError("");
                  setDirty(true);
                }}
                className="accent-accent-light"
              />
              <span className="text-sm font-medium">{t("admin.pmDiscountEnable")}</span>
            </label>
            <p className="text-xs text-muted mb-2">{t("admin.pmDiscountHelp")}</p>
            {discountEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("admin.discountType")}</label>
                  <select
                    value={discountType}
                    onChange={(e) => {
                      setDiscountType(e.target.value as "percentage" | "amount");
                      setDiscountError("");
                      setDirty(true);
                    }}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  >
                    <option value="percentage">{t("admin.percentage")}</option>
                    <option value="amount">{t("admin.fixedAmount")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    {discountType === "percentage" ? "%" : "$ USD"}
                  </label>
                  <input
                    type="number"
                    step={discountType === "percentage" ? "0.5" : "0.01"}
                    min="0.01"
                    max={discountType === "percentage" ? "100" : undefined}
                    value={discountValue}
                    onChange={(e) => { setDiscountValue(e.target.value); setDiscountError(""); setDirty(true); }}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  />
                </div>
                {discountError && (
                  <p className="col-span-2 text-xs text-danger">{discountError}</p>
                )}
              </div>
            )}
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
  eventId,
  methods,
  t,
}: {
  eventId: string;
  methods: PaymentMethod[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
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
      toast.error(t("admin.refreshFailed"));
    } finally {
      setRefreshingRate(false);
    }
  }

  const hasConversionMethods = methods.some((pm) => pm.convertCurrency);

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
            eventId={eventId}
            base={base}
            existing={methods.find(
              (pm) =>
                pm.type === base.type ||
                (!pm.type && pm.name.toLowerCase() === base.name.toLowerCase()),
            )}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

function CustomFieldCard({
  field,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragOver,
  t,
}: {
  field: CustomField;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const hasOptions = field.fieldType === "select" || field.fieldType === "multiselect";
  let parsedOptions: string[] = [];
  try {
    parsedOptions = field.options ? JSON.parse(field.options) : [];
  } catch {
    /* ignore */
  }

  function updateField(
    updates: Partial<{ label: string; fieldType: string; required: boolean; options: string }>,
  ) {
    db.transact(db.tx.guestListCustomFields[field.id].update(updates));
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
      db.transact(db.tx.guestListCustomFields[field.id].delete());
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
      <div className="flex items-center gap-3">
        <span className="text-muted select-none text-lg flex-shrink-0">&#x2630;</span>

        <div className="flex-1 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">{t("admin.fieldLabel")} *</label>
            <input
              value={field.label}
              onChange={(e) => updateField({ label: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder={t("admin.promoterPlaceholder")}
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
                <option key={ft} value={ft}>{getFieldTypeLabel(ft, t)}</option>
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
  eventId,
  fields,
  t,
}: {
  eventId: string;
  fields: CustomField[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function addField() {
    const maxSort = fields.reduce((max, f) => Math.max(max, f.sortOrder), -1);
    db.transact(
      db.tx.guestListCustomFields[genId()]
        .update({
          label: "",
          fieldType: "text",
          required: false,
          sortOrder: maxSort + 1,
          createdAt: Date.now(),
        })
        .link({ event: eventId }),
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
    const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder);
    const sourceIdx = sorted.findIndex((f) => f.id === sourceId);
    const targetIdx = sorted.findIndex((f) => f.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    db.transact(
      reordered.map((f, i) =>
        db.tx.guestListCustomFields[f.id].update({ sortOrder: i }),
      ),
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-semibold">{t("admin.customFields")}</h2>
      </div>
      <p className="text-sm text-muted mb-4">{t("admin.customFieldsSub")}</p>

      <div className="space-y-3">
        {fields.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            {t("admin.noCustomFields")}
          </p>
        ) : (
          [...fields]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((f) => (
              <CustomFieldCard
                key={f.id}
                field={f}
                onDragStart={(e) => handleDragStart(e, f.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverId(f.id);
                }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={(e) => handleDrop(e, f.id)}
                isDragOver={dragOverId === f.id}
                t={t}
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

function CollaboratorsSection({
  eventId,
  collaborators,
  ownerEmail,
  isPrimaryOwner,
  t,
}: {
  eventId: string;
  collaborators: Collaborator[];
  ownerEmail: string;
  isPrimaryOwner: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function addCollab(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (email === ownerEmail.toLowerCase()) {
      setError(t("guestList.collabSelfError"));
      return;
    }
    if (collaborators.some((c) => c.email.toLowerCase() === email)) {
      setError(t("guestList.collabDuplicate"));
      return;
    }
    const id = genId();
    try {
      await db.transact(
        db.tx.guestListCollaborators[id]
          .update({
            email,
            invitedAt: Date.now(),
            invitedByEmail: ownerEmail,
          })
          .link({ event: eventId }),
      );
      setNewEmail("");
    } catch (err) {
      setError(String(err));
    }
  }

  function removeCollab(c: Collaborator) {
    if (!confirm(t("guestList.collabConfirmRemove", { email: c.email }))) return;
    db.transact(db.tx.guestListCollaborators[c.id].delete());
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <h3 className="text-base font-semibold mb-2">{t("guestList.collabTitle")}</h3>
      <p className="text-xs text-muted mb-3">{t("guestList.collabHelp")}</p>
      {isPrimaryOwner && (
        <form onSubmit={addCollab} className="flex gap-2 mb-3">
          <input
            type="email"
            placeholder="email@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm"
          />
          <button
            type="submit"
            disabled={!newEmail.trim()}
            className="px-3 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {t("common.add")}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-danger mb-2">{error}</p>}
      {collaborators.length === 0 ? (
        <p className="text-xs text-muted">{t("guestList.collabEmpty")}</p>
      ) : (
        <div className="space-y-1.5">
          {collaborators.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between p-2 bg-background rounded-lg border border-border"
            >
              <span className="text-sm font-mono">{c.email}</span>
              {isPrimaryOwner && (
                <button
                  onClick={() => removeCollab(c)}
                  className="text-xs text-danger hover:underline"
                >
                  {t("common.remove") || "Quitar"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DangerZone({
  onDelete,
  t,
}: {
  onDelete: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="mt-12 pt-6 border-t border-border flex justify-end">
      <button
        onClick={onDelete}
        className="text-xs text-muted hover:text-danger transition-colors"
      >
        {t("guestList.deleteEvent")}
      </button>
    </div>
  );
}

function DeleteEventModal({
  eventId,
  eventName,
  entriesCount,
  approvedCount,
  onClose,
  onDeleted,
  t,
}: {
  eventId: string;
  eventName: string;
  entriesCount: number;
  approvedCount: number;
  onClose: () => void;
  onDeleted: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === eventName;

  async function confirmDelete() {
    if (!matches || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await db.transact(db.tx.guestListEvents[eventId].delete());
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface border border-danger/40 rounded-xl w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-lg text-danger">
            {t("guestList.deleteEvent")}
          </h2>
          <p className="text-sm text-muted mt-2">
            {t("guestList.deleteWarning", {
              entries: entriesCount,
              approved: approvedCount,
            })}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">
            {t("guestList.deleteConfirmLabel", { name: eventName })}
          </label>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={eventName}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-danger"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 bg-background border border-border rounded-lg text-sm font-medium"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={!matches || deleting}
            className="px-4 py-2 bg-danger hover:bg-danger/80 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold"
          >
            {deleting ? t("common.loading") : t("guestList.deleteConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  stringValue,
  subline,
  accent,
}: {
  label: string;
  value?: number;
  stringValue?: string;
  subline?: string;
  accent?: string;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent || ""}`}>
        {stringValue ?? value}
      </p>
      {subline && <p className="text-xs text-muted mt-0.5">{subline}</p>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-accent text-accent-light"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function EventForm({
  event,
  onUpdate,
  t,
}: {
  event: {
    id: string;
    name: string;
    date: string;
    venue?: string;
    description?: string;
    defaultPrice: number;
    capacity?: number;
    scannerPin?: string;
    primaryColor?: string;
  };
  onUpdate: (field: string, value: unknown) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [name, setName] = useState(event.name);
  const [date, setDate] = useState(event.date);
  const [venue, setVenue] = useState(event.venue || "");
  const [description, setDescription] = useState(event.description || "");
  const [defaultPrice, setDefaultPrice] = useState(event.defaultPrice.toString());
  const [capacity, setCapacity] = useState(
    event.capacity != null ? event.capacity.toString() : "",
  );
  const [pin, setPin] = useState(event.scannerPin || "");
  const [primary, setPrimary] = useState(event.primaryColor || "#1a2b4a");

  function commit(field: string, value: unknown) {
    onUpdate(field, value);
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 grid sm:grid-cols-2 gap-4">
      <Field label={t("common.name")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit("name", name)}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg"
        />
      </Field>
      <Field label={t("common.date")}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onBlur={() => commit("date", date)}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg"
        />
      </Field>
      <Field label={t("common.venue")}>
        <input
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          onBlur={() => commit("venue", venue)}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg"
        />
      </Field>
      <Field label={t("guestList.defaultPrice") + " (USD)"}>
        <input
          type="number"
          step="0.01"
          min="0"
          value={defaultPrice}
          onChange={(e) => setDefaultPrice(e.target.value)}
          onBlur={() => {
            const n = Number(defaultPrice);
            if (Number.isFinite(n) && n >= 0) commit("defaultPrice", n);
          }}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg"
        />
      </Field>
      <Field label={t("guestList.capacity") + " (" + t("common.optional") + ")"}>
        <input
          type="number"
          min="1"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          onBlur={() => {
            if (capacity === "") {
              commit("capacity", null);
            } else {
              const n = Number(capacity);
              if (Number.isFinite(n) && n >= 1) commit("capacity", Math.floor(n));
            }
          }}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg"
        />
      </Field>
      <Field label={t("guestList.scannerPin") + " (4-6 " + t("guestList.digits") + ")"}>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onBlur={() => {
            if (pin === "" || /^\d{4,6}$/.test(pin)) {
              commit("scannerPin", pin || null);
            }
          }}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg"
        />
      </Field>
      <Field label={t("guestList.primaryColor")}>
        <div className="flex gap-2">
          <input
            type="color"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            onBlur={() => commit("primaryColor", primary)}
            className="h-10 w-16 rounded-lg cursor-pointer"
          />
          <input
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            onBlur={() => commit("primaryColor", primary)}
            className="flex-1 px-3 py-2 bg-background border border-border rounded-lg font-mono text-sm"
          />
        </div>
      </Field>
      <Field label={t("common.description")}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => commit("description", description)}
          rows={2}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg resize-none"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function EntriesTable({
  entries,
  defaultPrice,
  ticketTypes,
  refreshToken,
  t,
}: {
  entries: Entry[];
  defaultPrice: number;
  ticketTypes: TicketType[];
  refreshToken: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");

  async function deleteEntry(entry: Entry) {
    const order = getOrder(entry);
    let cancelOrder = false;
    if (order && order.status !== "cancelled" && order.status !== "rejected") {
      const ok = confirm(
        t("guestList.confirmDeleteWithOrder", { number: order.orderNumber || order.id.slice(0, 8) }),
      );
      if (!ok) return;
      cancelOrder = confirm(t("guestList.confirmCancelOrder"));
    } else {
      const ok = confirm(t("guestList.confirmDelete"));
      if (!ok) return;
    }
    const url = `/api/guest-list/entry/${entry.id}${cancelOrder ? "?cancelOrder=true" : ""}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Delete failed");
    }
  }

  async function updatePrice(entry: Entry, value: string) {
    const num = value === "" ? null : Number(value);
    if (num !== null && (!Number.isFinite(num) || num < 0)) {
      alert(t("guestList.invalidPrice"));
      return;
    }
    const res = await fetch(`/api/guest-list/entry/${entry.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${refreshToken}`,
      },
      body: JSON.stringify({ priceOverride: num }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Update failed");
    }
    setEditingPrice(null);
  }

  if (entries.length === 0) {
    return (
      <p className="text-muted text-center py-8 bg-surface border border-border rounded-xl">
        {t("guestList.noEntriesMatching")}
      </p>
    );
  }

  async function updateTicketType(entry: Entry, ticketTypeId: string) {
    try {
      await db.transact(
        db.tx.guestListEntries[entry.id].link({ ticketType: ticketTypeId }),
      );
    } catch (err) {
      alert(String(err));
    }
  }

  return (
    <div className="overflow-x-auto bg-surface border border-border rounded-xl">
      <table className="w-full text-sm">
        <thead className="bg-background border-b border-border">
          <tr>
            <Th>{t("guestList.colName")}</Th>
            <Th>{t("guestList.colEmail")}</Th>
            <Th>{t("guestList.colCedula")}</Th>
            <Th>{t("guestList.colTicketType")}</Th>
            <Th className="text-right">{t("guestList.colPrice")}</Th>
            <Th>{t("guestList.colStatus")}</Th>
            <Th className="text-right"></Th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const order = getOrder(entry);
            const ticketType = getEntryTicketType(entry);
            const ttPrice = ticketType
              ? ticketTypes.find((t) => t.id === ticketType.id)?.price ?? defaultPrice
              : defaultPrice;
            const effectivePrice =
              typeof entry.priceOverride === "number" ? entry.priceOverride : ttPrice;
            return (
              <tr key={entry.id} className="border-t border-border">
                <Td>
                  {entry.firstName || entry.lastName
                    ? `${entry.firstName || ""} ${entry.lastName || ""}`.trim()
                    : <span className="text-muted">—</span>}
                </Td>
                <Td className="font-mono text-xs">{entry.email || "—"}</Td>
                <Td className="font-mono text-xs">{entry.cedula || "—"}</Td>
                <Td>
                  <select
                    value={ticketType?.id || ""}
                    onChange={(e) => updateTicketType(entry, e.target.value)}
                    disabled={entry.status === "registered" || ticketTypes.length === 0}
                    className="px-2 py-1 bg-background border border-border rounded text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {!ticketType && <option value="">—</option>}
                    {ticketTypes.map((tt) => (
                      <option key={tt.id} value={tt.id}>
                        {tt.name}
                      </option>
                    ))}
                  </select>
                </Td>
                <Td className="text-right">
                  {editingPrice === entry.id ? (
                    <input
                      autoFocus
                      type="number"
                      step="0.01"
                      min="0"
                      value={priceDraft}
                      onChange={(e) => setPriceDraft(e.target.value)}
                      onBlur={() => updatePrice(entry, priceDraft)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") updatePrice(entry, priceDraft);
                        if (e.key === "Escape") setEditingPrice(null);
                      }}
                      className="w-24 px-2 py-1 bg-background border border-accent rounded text-right"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setEditingPrice(entry.id);
                        setPriceDraft(
                          typeof entry.priceOverride === "number"
                            ? String(entry.priceOverride)
                            : "",
                        );
                      }}
                      disabled={entry.status === "registered"}
                      className="text-right hover:text-accent-light disabled:cursor-not-allowed"
                    >
                      <span className="font-medium">${effectivePrice.toFixed(2)}</span>
                      {typeof entry.priceOverride === "number" && (
                        <span className="block text-xs text-accent-light">
                          {t("guestList.override")}
                        </span>
                      )}
                    </button>
                  )}
                </Td>
                <Td>
                  <StatusPill status={entry.status} t={t} />
                  {order?.orderNumber && (
                    <span className="block text-xs text-muted font-mono mt-0.5">
                      {order.orderNumber}
                    </span>
                  )}
                </Td>
                <Td className="text-right">
                  <button
                    onClick={() => deleteEntry(entry)}
                    className="text-xs text-danger hover:underline"
                  >
                    {t("common.delete")}
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: string;
  t: (key: string) => string;
}) {
  const cfg: Record<string, { cls: string; label: string }> = {
    invited: { cls: "bg-accent/10 text-accent-light border-accent/30", label: t("guestList.statInvited") },
    registered: { cls: "bg-success/10 text-success border-success/30", label: t("guestList.statRegistered") },
    revoked: { cls: "bg-muted/10 text-muted border-muted/30", label: t("guestList.statRevoked") },
  };
  const c = cfg[status] || cfg.invited;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${c.cls}`}>
      {c.label}
    </span>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide ${className || ""}`}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className || ""}`}>{children}</td>;
}

const TEMPLATE_CSV =
  "email,cedula,nombre,apellido,tipo,precio\n" +
  "juan@example.com,12345678,Juan,Pérez,VIP,25.00\n" +
  "maria@example.com,87654321,María,González,General,\n" +
  "pedro@example.com,,Pedro,,General,\n" +
  ",11223344,,,VIP,0\n";

function downloadTemplate() {
  const blob = new Blob(["﻿" + TEMPLATE_CSV], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla-invitados.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function UploadModal({
  eventId,
  refreshToken,
  ticketTypes,
  onClose,
  t,
}: {
  eventId: string;
  refreshToken: string;
  ticketTypes: TicketType[];
  onClose: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultTicketTypeId, setDefaultTicketTypeId] = useState(
    ticketTypes[0]?.id || "",
  );

  async function handleFile(file: File) {
    setError(null);
    setParsed(null);
    setResult(null);
    const ext = file.name.split(".").pop()?.toLowerCase();
    try {
      if (ext === "csv" || ext === "txt") {
        const text = await file.text();
        const r = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
        });
        const result = parseRows(r.data);
        setParsed(result);
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        const result = parseRows(rows);
        setParsed(result);
      } else {
        setError(t("guestList.unsupportedFile"));
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function commit() {
    if (!parsed || parsed.valid.length === 0) return;
    setUploading(true);
    try {
      const res = await fetch("/api/guest-list/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({
          eventId,
          entries: parsed.valid as ParsedEntry[],
          defaultTicketTypeId: defaultTicketTypeId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Upload failed");
      } else {
        setResult(t("guestList.uploadDone", { inserted: body.inserted, skipped: body.skipped }));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-surface border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold">{t("guestList.uploadTitle")}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted">{t("guestList.uploadHelp")}</p>
          {ticketTypes.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-muted uppercase mb-1.5">
                {t("guestList.defaultTicketTypeLabel")}
              </label>
              <select
                value={defaultTicketTypeId}
                onChange={(e) => setDefaultTicketTypeId(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
              >
                {ticketTypes.map((tt) => (
                  <option key={tt.id} value={tt.id}>
                    {tt.name} (${tt.price.toFixed(2)})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted mt-1">{t("guestList.defaultTicketTypeHint")}</p>
            </div>
          )}
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-background border border-border hover:border-accent/50 rounded-lg text-sm font-medium"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path
                fillRule="evenodd"
                d="M10 3a.75.75 0 01.75.75v6.69l1.97-1.97a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L6.22 9.53a.75.75 0 011.06-1.06l1.97 1.97V3.75A.75.75 0 0110 3zM3.75 14a.75.75 0 01.75.75v.5c0 .414.336.75.75.75h9.5a.75.75 0 00.75-.75v-.5a.75.75 0 011.5 0v.5A2.25 2.25 0 0114.75 17.5h-9.5A2.25 2.25 0 013 15.25v-.5a.75.75 0 01.75-.75z"
                clipRule="evenodd"
              />
            </svg>
            {t("guestList.downloadTemplate")}
          </button>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="block w-full text-sm file:mr-4 file:px-4 file:py-2 file:rounded-lg file:bg-accent file:text-white file:border-0 file:font-medium hover:file:bg-accent-dark"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          {parsed && (
            <div className="space-y-2">
              <p className="text-sm">
                {t("guestList.previewCounts", {
                  valid: parsed.valid.length,
                  invalid: parsed.invalid.length,
                })}
              </p>
              {parsed.invalid.length > 0 && (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">{t("guestList.viewInvalid")}</summary>
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {parsed.invalid.slice(0, 50).map((i, idx) => (
                      <li key={idx}>
                        Row {i.row}: {i.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {parsed.valid.length > 0 && (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">{t("guestList.viewValid")}</summary>
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto font-mono">
                    {parsed.valid.slice(0, 50).map((e, idx) => (
                      <li key={idx}>
                        {e.email || "(no email)"} | {e.cedula || "(no cedula)"} | {e.firstName || ""} {e.lastName || ""}
                        {typeof e.priceOverride === "number" && ` | $${e.priceOverride}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {result && <p className="text-sm text-success">{result}</p>}
        </div>
        <div className="p-5 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-background border border-border rounded-lg text-sm"
          >
            {t("common.close")}
          </button>
          <button
            onClick={commit}
            disabled={!parsed || parsed.valid.length === 0 || uploading || !!result}
            className="px-4 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {uploading ? t("common.loading") : t("guestList.confirmUpload")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualEntryModal({
  eventId,
  refreshToken,
  ticketTypes,
  onClose,
  t,
}: {
  eventId: string;
  refreshToken: string;
  ticketTypes: TicketType[];
  onClose: () => void;
  t: (key: string) => string;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cedula, setCedula] = useState("");
  const [priceOverride, setPriceOverride] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/guest-list/add-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({
          eventId,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          email: email || undefined,
          cedula: cedula || undefined,
          priceOverride: priceOverride !== "" ? Number(priceOverride) : undefined,
          ticketTypeId: ticketTypeId || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Failed");
      } else {
        onClose();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={submit}
        className="bg-surface border border-border rounded-xl w-full max-w-md p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("guestList.addManualTitle")}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-foreground">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("guestList.colName")}>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg"
            />
          </Field>
          <Field label={t("guestList.colLastName")}>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg"
            />
          </Field>
        </div>
        <Field label={t("guestList.colEmail")}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg"
          />
        </Field>
        <Field label={t("guestList.colCedula")}>
          <input
            value={cedula}
            onChange={(e) => setCedula(e.target.value.replace(/\D/g, ""))}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg"
          />
        </Field>
        {ticketTypes.length > 0 && (
          <Field label={t("guestList.colTicketType")}>
            <select
              value={ticketTypeId}
              onChange={(e) => setTicketTypeId(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded-lg"
            >
              {ticketTypes.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.name} (${tt.price.toFixed(2)})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("guestList.colPrice") + " (USD, " + t("common.optional") + ")"}>
          <input
            type="number"
            step="0.01"
            min="0"
            value={priceOverride}
            onChange={(e) => setPriceOverride(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg"
            placeholder={t("guestList.priceOverridePlaceholder")}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-background border border-border rounded-lg text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {submitting ? t("common.loading") : t("guestList.add")}
          </button>
        </div>
      </form>
    </div>
  );
}

function FeesSection({
  ticketTypes,
  t,
}: {
  ticketTypes: TicketType[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
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
      <p className="text-muted text-xs mb-4">{t("admin.feeDescription")}</p>
      <div className="space-y-3">
        {ticketTypes.map((tt) => (
          <FeeRow key={tt.id} tt={tt} t={t} />
        ))}
      </div>
    </div>
  );
}

function FeeRow({
  tt,
  t,
}: {
  tt: TicketType;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const currentPrice = tt.price;
  const feePercent = tt.feePercent ?? 0;
  const feeFixed = tt.feeFixed ?? 0;
  const calculatedFee = (currentPrice * feePercent) / 100 + feeFixed;

  function updateFee(field: "feePercent" | "feeFixed", value: string) {
    const num = parseFloat(value);
    db.transact(
      db.tx.guestListTicketTypes[tt.id].update({
        [field]: isNaN(num) ? 0 : num,
      }),
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">{tt.name}</p>
        <p className="text-xs text-muted mt-0.5">
          {t("admin.basePrice")}: ${tt.price.toFixed(2)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">
            {t("admin.feePercent")}
          </label>
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
          <label className="block text-xs font-medium mb-1">
            {t("admin.feeFixed")}
          </label>
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
            <span>
              {t("admin.feeCalcPercent", {
                amount: ((currentPrice * feePercent) / 100).toFixed(2),
                percent: feePercent,
              })}
            </span>
          )}
          {feePercent > 0 && feeFixed > 0 && " + "}
          {feeFixed > 0 && (
            <span>
              {t("admin.feeCalcFixed", { amount: feeFixed.toFixed(2) })}
            </span>
          )}
          {" = "}
          <span className="font-medium text-foreground">
            {t("admin.feeCalcTotal", { amount: calculatedFee.toFixed(2) })}
          </span>
        </p>
      )}
    </div>
  );
}

function PlatformFeeSection({
  eventId,
  feeConfig,
  isSuperAdmin,
  isDemo,
  t,
}: {
  eventId: string;
  feeConfig:
    | { id: string; feePercent: number; feeFixed: number; billingMode: string }
    | undefined;
  isSuperAdmin: boolean;
  isDemo: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [feePercent, setFeePercent] = useState(
    feeConfig?.feePercent?.toString() || "5",
  );
  const [feeFixed, setFeeFixed] = useState(
    feeConfig?.feeFixed?.toString() || "0",
  );
  const [billingMode, setBillingMode] = useState(
    feeConfig?.billingMode || "prepaid",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
        await db.transact([
          db.tx.guestListPlatformFeeConfigs[feeConfig.id].update(data),
        ]);
      } else {
        const newId = genId();
        await db.transact([
          db.tx.guestListPlatformFeeConfigs[newId]
            .update(data)
            .link({ event: eventId }),
        ]);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save fee config:", err);
      toast.error(t("admin.communications.feeConfigSaveError"));
    } finally {
      setSaving(false);
    }
  }

  if (!isSuperAdmin) {
    if (!feeConfig) return null;
    return (
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="text-lg font-bold mb-4">
          {t("admin.platformFeeConfig")}
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm text-muted">{t("admin.pFeePercent")}</p>
            <p className="text-lg font-semibold">{feeConfig.feePercent}%</p>
          </div>
          <div>
            <p className="text-sm text-muted">{t("admin.pFeeFixed")}</p>
            <p className="text-lg font-semibold">
              ${feeConfig.feeFixed.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted">{t("admin.billingMode")}</p>
            <p className="text-lg font-semibold">
              {t(
                feeConfig.billingMode === "postpaid"
                  ? "admin.postpaid"
                  : "admin.prepaid",
              )}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted mt-3">
          {t("admin.pFeePreview", {
            price: previewPrice.toFixed(2),
            fee: (
              (feeConfig.feePercent / 100) * previewPrice +
              feeConfig.feeFixed
            ).toFixed(2),
          })}
        </p>
      </div>
    );
  }

  function toggleDemo() {
    db.transact(
      db.tx.guestListEvents[eventId].update({ isDemo: !isDemo }),
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-lg font-bold mb-4">{t("admin.platformFeeConfig")}</h2>
      <div
        className={`mb-4 p-3 rounded-lg border ${isDemo ? "bg-accent/5 border-accent/30" : "bg-background border-border"}`}
      >
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isDemo}
            onChange={toggleDemo}
            className="mt-1 accent-accent"
          />
          <div>
            <p className="font-medium text-sm">{t("admin.demoEvent")}</p>
            <p className="text-xs text-muted mt-0.5">
              {t("admin.demoEventDesc")}
            </p>
          </div>
        </label>
      </div>
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
            <div className="text-xs font-normal mt-0.5 opacity-70">
              {t("admin.prepaidDesc")}
            </div>
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
            <div className="text-xs font-normal mt-0.5 opacity-70">
              {t("admin.postpaidDesc")}
            </div>
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

