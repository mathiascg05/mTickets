"use client";

import { db } from "@/lib/db";
import { getActivePhase, getTodayString } from "@/lib/phases";
import type { Phase } from "@/lib/phases";
import { id } from "@instantdb/react";
import { extractDominantColor } from "@/lib/colorExtract";
import { useParams } from "next/navigation";
import { useRef, useState } from "react";

export default function AdminConcertEditPage() {
  const params = useParams();
  const concertId = params.id as string;

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
      promoters: {
        $: { order: { createdAt: "asc" } },
      },
      coupons: {
        $: { order: { createdAt: "asc" } },
      },
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">Loading...</div>;
  }

  const concert = data.concerts[0];
  if (!concert) {
    return <div className="text-muted">Event not found</div>;
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
          <PromotersSection
            concertId={concertId}
            promoters={concert.promoters}
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
        {copied ? "Copied!" : "Copy Link"}
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
};

function ConcertEditForm({ concert }: { concert: ConcertData }) {
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
    if (confirm("Delete this event? This cannot be undone.")) {
      db.transact(db.tx.concerts[concert.id].delete());
      window.location.href = "/admin/concerts";
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Event Details</h2>
        <button
          onClick={toggleStatus}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            concert.status === "active"
              ? "bg-success/10 text-success border-success/30 hover:bg-success/20"
              : "bg-muted/10 text-muted border-muted/30 hover:bg-muted/20"
          }`}
        >
          {concert.status === "active" ? "Active" : "Draft"} - Click to toggle
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Date</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Venue</label>
          <input
            required
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Description
          </label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors resize-none"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
          >
            Save Changes
          </button>
          {saved && (
            <span className="text-success text-sm">{"✓"} Saved!</span>
          )}
          <button
            type="button"
            onClick={deleteConcert}
            className="ml-auto px-4 py-2.5 text-danger hover:bg-danger/10 rounded-lg text-sm font-medium transition-colors"
          >
            Delete Event
          </button>
        </div>
      </form>
    </div>
  );
}

type PaymentMethodData = {
  id: string;
  name: string;
  instructions: string;
  convertCurrency?: string;
  requireScreenshot?: boolean;
  requireReferenceNumber?: boolean;
};

function PaymentMethodsSection({
  concertId,
  paymentMethods,
}: {
  concertId: string;
  paymentMethods: PaymentMethodData[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [convertCurrency, setConvertCurrency] = useState("");
  const [requireScreenshot, setRequireScreenshot] = useState(true);
  const [requireReferenceNumber, setRequireReferenceNumber] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editConvertCurrency, setEditConvertCurrency] = useState("");
  const [editRequireScreenshot, setEditRequireScreenshot] = useState(true);
  const [editRequireReferenceNumber, setEditRequireReferenceNumber] = useState(false);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    db.transact(
      db.tx.paymentMethods[id()]
        .update({
          name,
          instructions,
          convertCurrency: convertCurrency || undefined,
          requireScreenshot,
          requireReferenceNumber,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );
    setName("");
    setInstructions("");
    setConvertCurrency("");
    setRequireScreenshot(true);
    setRequireReferenceNumber(false);
    setShowForm(false);
  }

  function startEdit(pm: PaymentMethodData) {
    setEditingId(pm.id);
    setEditName(pm.name);
    setEditInstructions(pm.instructions);
    setEditConvertCurrency(pm.convertCurrency || "");
    setEditRequireScreenshot(pm.requireScreenshot !== false);
    setEditRequireReferenceNumber(pm.requireReferenceNumber === true);
  }

  function saveEdit() {
    if (!editingId) return;
    db.transact(
      db.tx.paymentMethods[editingId].update({
        name: editName,
        instructions: editInstructions,
        convertCurrency: editConvertCurrency || undefined,
        requireScreenshot: editRequireScreenshot,
        requireReferenceNumber: editRequireReferenceNumber,
      }),
    );
    setEditingId(null);
  }

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
      alert("Failed to refresh rates. Please try again.");
    } finally {
      setRefreshingRate(false);
    }
  }

  function deletePaymentMethod(pmId: string) {
    if (confirm("Delete this payment method?")) {
      db.transact(db.tx.paymentMethods[pmId].delete());
    }
  }

  const hasConversionMethods = paymentMethods.some((pm) => pm.convertCurrency);

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Payment Methods</h2>
        <div className="flex items-center gap-2">
          {hasConversionMethods && (
            <button
              onClick={refreshBcvRates}
              disabled={refreshingRate}
              className="px-3 py-1.5 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {rateRefreshed ? "Refreshed!" : refreshingRate ? "Refreshing..." : "Refresh BCV Rate"}
            </button>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
          >
            {showForm ? "Cancel" : "+ Add"}
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-4 mb-4 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder="e.g., Bank Transfer, Zelle, Venmo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Instructions
            </label>
            <textarea
              required
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm resize-none"
              placeholder="e.g., Transfer to Account #12345..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Currency Conversion
            </label>
            <select
              value={convertCurrency}
              onChange={(e) => setConvertCurrency(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            >
              <option value="">None</option>
              <option value="USD">USD &rarr; Bs</option>
              <option value="EUR">EUR &rarr; Bs</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Required Proof Fields</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireScreenshot}
                  onChange={(e) => setRequireScreenshot(e.target.checked)}
                  className="accent-accent-light"
                />
                <span className="text-sm">Require screenshot upload</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireReferenceNumber}
                  onChange={(e) => setRequireReferenceNumber(e.target.checked)}
                  className="accent-accent-light"
                />
                <span className="text-sm">Require reference number</span>
              </label>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Add Payment Method
          </button>
        </form>
      )}

      <div className="space-y-3">
        {paymentMethods.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            No payment methods yet. Add one so buyers can see payment instructions.
          </p>
        ) : (
          paymentMethods.map((pm) =>
            editingId === pm.id ? (
              <div
                key={pm.id}
                className="bg-background border border-accent/30 rounded-lg p-4 space-y-3"
              >
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Instructions
                  </label>
                  <textarea
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Currency Conversion
                  </label>
                  <select
                    value={editConvertCurrency}
                    onChange={(e) => setEditConvertCurrency(e.target.value)}
                    className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                  >
                    <option value="">None</option>
                    <option value="USD">USD &rarr; Bs</option>
                    <option value="EUR">EUR &rarr; Bs</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Required Proof Fields</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editRequireScreenshot}
                        onChange={(e) => setEditRequireScreenshot(e.target.checked)}
                        className="accent-accent-light"
                      />
                      <span className="text-sm">Require screenshot upload</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editRequireReferenceNumber}
                        onChange={(e) => setEditRequireReferenceNumber(e.target.checked)}
                        className="accent-accent-light"
                      />
                      <span className="text-sm">Require reference number</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={saveEdit}
                    className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 text-muted hover:text-foreground text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={pm.id}
                className="flex items-start justify-between p-4 border border-border rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{pm.name}</p>
                    {pm.convertCurrency && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-accent/15 text-accent-light">
                        {pm.convertCurrency} &rarr; Bs
                      </span>
                    )}
                    {pm.requireScreenshot !== false && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-success/15 text-success">
                        Screenshot
                      </span>
                    )}
                    {pm.requireReferenceNumber && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-warning/15 text-warning">
                        Ref. #
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted mt-1 whitespace-pre-wrap">
                    {pm.instructions}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <button
                    onClick={() => startEdit(pm)}
                    className="text-muted hover:text-accent-light transition-colors text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deletePaymentMethod(pm.id)}
                    className="text-muted hover:text-danger transition-colors text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ),
          )
        )}
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
    if (confirm("Delete this ticket type?")) {
      db.transact(db.tx.ticketTypes[ttId].delete());
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Ticket Types</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-4 mb-4 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder="e.g., General Admission"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Price</label>
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
                Quantity
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
              Description (optional)
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder="Includes access to..."
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Add Ticket Type
          </button>
        </form>
      )}

      <div className="space-y-3">
        {ticketTypes.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            No ticket types yet.
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
  const [showPhases, setShowPhases] = useState(false);

  return (
    <div className="border border-border rounded-lg">
      <div className="flex items-center justify-between p-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{tt.name}</p>
            {tt.visibility === "hidden" && (
              <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px] font-semibold uppercase tracking-wider">Hidden</span>
            )}
            {tt.visibility === "soldOutOverride" && (
              <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] font-semibold uppercase tracking-wider">Forced Sold Out</span>
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
                <span className="text-danger font-medium">All phases exhausted &middot; </span>
              )}
              {sold}/{totalCapacity} sold (phases)
            </p>
          ) : (
            <p className="text-sm text-muted mt-1">
              ${tt.price.toFixed(2)} &middot; {sold}/{tt.quantity} sold
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
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
            <option value="soldOutOverride">Show as Sold Out</option>
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
            # disp.
          </label>
          <button
            onClick={() => setShowPhases(!showPhases)}
            className="px-3 py-1.5 border border-border hover:border-accent/50 text-muted hover:text-accent-light rounded-lg text-xs font-medium transition-colors"
          >
            {showPhases ? "Hide Phases" : "Manage Phases"}
          </button>
          <button
            onClick={onDelete}
            className="text-muted hover:text-danger transition-colors text-sm"
          >
            Delete
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
    if (confirm("Delete this phase?")) {
      db.transact(db.tx.ticketPhases[phaseId].delete());
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Pricing Phases</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-2.5 py-1 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors"
        >
          {showForm ? "Cancel" : "+ Add Phase"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-3 space-y-2"
        >
          <div>
            <label className="block text-xs font-medium mb-1">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              placeholder="e.g., Fase 1"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Price</label>
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
              <label className="block text-xs font-medium mb-1">Qty</label>
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
              <label className="block text-xs font-medium mb-1">End Date</label>
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
            Add Phase
          </button>
        </form>
      )}

      {phases.length === 0 ? (
        <p className="text-muted text-xs text-center py-3">
          No phases. Add phases to enable tiered pricing.
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
                    <label className="block text-xs font-medium mb-1">Name</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium mb-1">Price</label>
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
                      <label className="block text-xs font-medium mb-1">Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={editQuantity}
                        onChange={(e) => setEditQuantity(e.target.value)}
                        className="w-full px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">End Date</label>
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
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 text-muted hover:text-foreground text-xs transition-colors"
                    >
                      Cancel
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
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    ${p.price.toFixed(2)} &middot; {phaseSold}/{p.quantity} sold
                    {p.endDate && <> &middot; ends {p.endDate}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-muted hover:text-accent-light transition-colors text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deletePhase(p.id)}
                    className="text-muted hover:text-danger transition-colors text-xs"
                  >
                    Delete
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
  if (ticketTypes.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-2">Service Fees</h2>
        <p className="text-muted text-sm text-center py-6">
          Add ticket types first to configure fees.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <h2 className="text-xl font-semibold mb-1">Service Fees</h2>
      <p className="text-muted text-xs mb-4">
        Set a percentage and/or fixed USD fee per ticket type. Both are combined.
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
            Base price: ${tt.price.toFixed(2)}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1">Fee %</label>
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
          <label className="block text-xs font-medium mb-1">Fee $ (USD)</label>
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
          On ${currentPrice.toFixed(2)} ticket:{" "}
          {feePercent > 0 && (
            <span>${((currentPrice * feePercent) / 100).toFixed(2)} ({feePercent}%)</span>
          )}
          {feePercent > 0 && feeFixed > 0 && " + "}
          {feeFixed > 0 && <span>${feeFixed.toFixed(2)} fixed</span>}
          {" = "}
          <span className="font-medium text-foreground">
            ${calculatedFee.toFixed(2)} fee
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
    if (confirm("Delete this coupon?")) {
      db.transact(db.tx.coupons[couponId].delete());
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Coupons</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-4 mb-4 space-y-3"
        >
          <div>
            <label className="block text-sm font-medium mb-1">Code</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm uppercase"
              placeholder="e.g., SALE20"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">
                Discount Type
              </label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
              >
                <option value="percentage">Percentage (%)</option>
                <option value="amount">Fixed Amount ($)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {discountType === "percentage" ? "Percentage" : "Amount"}
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
                Max Uses (optional)
              </label>
              <input
                type="number"
                min="1"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="Unlimited"
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
                <span className="text-sm font-medium">Active</span>
              </label>
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Add Coupon
          </button>
        </form>
      )}

      <div className="space-y-2">
        {coupons.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            No coupons yet. Add a coupon to offer discounts to buyers.
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
                      Code
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
                        Discount Type
                      </label>
                      <select
                        value={editDiscountType}
                        onChange={(e) => setEditDiscountType(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                      >
                        <option value="percentage">Percentage (%)</option>
                        <option value="amount">Fixed Amount ($)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {editDiscountType === "percentage"
                          ? "Percentage"
                          : "Amount"}
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
                        Max Uses
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={editMaxUses}
                        onChange={(e) => setEditMaxUses(e.target.value)}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                        placeholder="Unlimited"
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
                        <span className="text-sm font-medium">Active</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 text-muted hover:text-foreground text-sm transition-colors"
                    >
                      Cancel
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
                      {c.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-0.5">
                    {c.discountType === "percentage"
                      ? `${c.discountValue}% off`
                      : `$${c.discountValue.toFixed(2)} off`}
                    {" \u00B7 "}
                    {usage}
                    {c.maxUses != null ? `/${c.maxUses}` : ""} used
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <button
                    onClick={() => startEdit(c)}
                    className="text-muted hover:text-accent-light transition-colors text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteCoupon(c.id)}
                    className="text-muted hover:text-danger transition-colors text-xs"
                  >
                    Delete
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

type PromoterData = {
  id: string;
  name: string;
};

function PromotersSection({
  concertId,
  promoters,
}: {
  concertId: string;
  promoters: PromoterData[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    db.transact(
      db.tx.promoters[id()]
        .update({
          name,
          createdAt: Date.now(),
        })
        .link({ concert: concertId }),
    );
    setName("");
    setShowForm(false);
  }

  function startEdit(p: PromoterData) {
    setEditingId(p.id);
    setEditName(p.name);
  }

  function saveEdit() {
    if (!editingId) return;
    db.transact(db.tx.promoters[editingId].update({ name: editName }));
    setEditingId(null);
  }

  function deletePromoter(pId: string) {
    if (confirm("Delete this promoter?")) {
      db.transact(db.tx.promoters[pId].delete());
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Promoters</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-background border border-border rounded-lg p-4 mb-4 flex gap-3"
        >
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
            placeholder="Promoter name"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
          >
            Add
          </button>
        </form>
      )}

      <div className="space-y-2">
        {promoters.length === 0 ? (
          <p className="text-muted text-sm text-center py-6">
            No promoters yet. Add promoters so buyers can select one during purchase.
          </p>
        ) : (
          promoters.map((p) =>
            editingId === p.id ? (
              <div
                key={p.id}
                className="flex items-center gap-2 p-3 border border-accent/30 rounded-lg bg-background"
              >
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
                />
                <button
                  onClick={saveEdit}
                  className="px-3 py-1.5 bg-accent hover:bg-accent-dark text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1.5 text-muted hover:text-foreground text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                key={p.id}
                className="flex items-center justify-between p-3 border border-border rounded-lg"
              >
                <p className="font-medium text-sm">{p.name}</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(p)}
                    className="text-muted hover:text-accent-light transition-colors text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deletePromoter(p.id)}
                    className="text-muted hover:text-danger transition-colors text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ),
          )
        )}
      </div>
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
      <h2 className="text-lg font-semibold mb-4">Door Scanner PIN</h2>
      <p className="text-sm text-muted mb-4">
        Share this PIN with door staff. They access the scanner at{" "}
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
          placeholder="4-6 digit PIN"
          className="flex-1 px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-center font-mono text-xl tracking-[0.3em]"
        />
        <button
          onClick={generatePin}
          className="px-3 py-2.5 border border-border rounded-lg hover:bg-surface-hover transition-colors text-sm font-medium"
        >
          Generate
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!pin || pin.length < 4}
          className="flex-1 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
        >
          {saved ? "Saved!" : "Save PIN"}
        </button>
        {currentPin && (
          <button
            onClick={handleClear}
            className="px-4 py-2.5 border border-danger/30 text-danger rounded-lg hover:bg-danger/10 transition-colors text-sm font-medium"
          >
            Clear PIN
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
      <h2 className="text-lg font-bold mb-4">Branding</h2>

      {/* Flyer */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Event Flyer</label>
        {flyerUrl ? (
          <div className="space-y-3">
            <div className="relative rounded-xl overflow-hidden border border-border">
              <img
                src={flyerUrl}
                alt="Event flyer"
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
                <span className="text-xs text-muted">Auto-extracted color</span>
              </div>
            )}
            <button
              onClick={removeFlyer}
              className="text-sm text-danger hover:text-danger/80 transition-colors"
            >
              Remove flyer
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
                Uploading & extracting color...
              </p>
            )}
          </div>
        )}
      </div>

      {/* Logo */}
      <div>
        <label className="block text-sm font-medium mb-2">Event Logo</label>
        {logoUrl ? (
          <div className="space-y-3">
            <div className="inline-block rounded-xl overflow-hidden border border-border bg-background p-2">
              <img
                src={logoUrl}
                alt="Event logo"
                className="h-16 w-auto object-contain"
              />
            </div>
            <div>
              <button
                onClick={removeLogo}
                className="text-sm text-danger hover:text-danger/80 transition-colors"
              >
                Remove logo
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
                Uploading logo...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
