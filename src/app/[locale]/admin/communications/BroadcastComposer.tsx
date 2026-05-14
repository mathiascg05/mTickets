"use client";

import { useState, useMemo, useCallback } from "react";
import { useLanguage } from "@/lib/LanguageContext";

type TicketType = { id: string; name: string };
type PaymentMethod = { id: string; type: string; name: string };

type PreviewRecipient = {
  email: string;
  firstName: string;
  lastName: string;
  ticketTypeName: string;
  paymentMethod: string;
  status: string;
};

type PreviewData = {
  totalCount: number;
  suppressedCount: number;
  sample: PreviewRecipient[];
  concertTotalOrderCount?: number;
};

type SendResult = {
  sentCount: number;
  failedCount: number;
  suppressedCount: number;
  recipientCount: number;
};

type Concert = {
  id: string;
  name: string;
  ticketTypes?: TicketType[];
  paymentMethods?: PaymentMethod[];
};

type Step = "compose" | "preview" | "result";

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

function Chip({
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
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
        active
          ? "bg-accent text-white border-accent"
          : "bg-surface text-foreground border-border hover:border-accent/40"
      }`}
    >
      {children}
    </button>
  );
}

export default function BroadcastComposer({
  concerts,
  refreshToken,
  onClose,
}: {
  concerts: Concert[];
  refreshToken: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const orderStatusOptions = useMemo(
    () => [
      { value: "approved", label: t("common.approved") },
      { value: "pending", label: t("common.pending") },
      { value: "rejected", label: t("common.rejected") },
      { value: "cancelled", label: t("common.cancelled") },
    ],
    [t],
  );

  const [step, setStep] = useState<Step>("compose");
  const [concertId, setConcertId] = useState<string>(concerts[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ticketTypeIds, setTicketTypeIds] = useState<string[]>([]);
  const [paymentMethodTypes, setPaymentMethodTypes] = useState<string[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<string[]>(["approved"]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  const selectedConcert = useMemo(
    () => concerts.find((c) => c.id === concertId),
    [concertId, concerts],
  );

  const availableTicketTypes: TicketType[] = selectedConcert?.ticketTypes ?? [];
  const availablePaymentMethods: PaymentMethod[] = selectedConcert?.paymentMethods ?? [];

  // Deduplicate payment method types (an event may have multiple PM rows of same type).
  // Track the count so the chip can show "(N accounts)" when a single type covers
  // multiple PM rows — the filter sends the `type` and the backend expands to all
  // names of that type, so the organizer should know the chip is plural.
  const paymentMethodOptions = useMemo(() => {
    const byType = new Map<string, { name: string; count: number }>();
    for (const pm of availablePaymentMethods) {
      const existing = byType.get(pm.type);
      if (existing) {
        existing.count += 1;
      } else {
        byType.set(pm.type, { name: pm.name || pm.type, count: 1 });
      }
    }
    return Array.from(byType, ([type, { name, count }]) => ({ type, name, count }));
  }, [availablePaymentMethods]);

  const hasAnyFilter =
    ticketTypeIds.length > 0 ||
    paymentMethodTypes.length > 0 ||
    orderStatuses.length > 0;

  const toggle = (list: string[], setList: (l: string[]) => void) => (value: string) => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const handleLoadPreview = useCallback(async () => {
    setError("");
    if (!concertId) {
      setError(t("admin.broadcast.selectEvent"));
      return;
    }
    if (!subject.trim() || subject.length > SUBJECT_MAX) {
      setError(t("admin.broadcast.subjectRequired", { max: SUBJECT_MAX }));
      return;
    }
    if (!body.trim() || body.length > BODY_MAX) {
      setError(t("admin.broadcast.bodyRequired", { max: BODY_MAX }));
      return;
    }
    if (!hasAnyFilter) {
      setError(t("admin.broadcast.selectFilter"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/broadcast-preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({
          concertId,
          filters: { ticketTypeIds, paymentMethodTypes, orderStatuses },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("admin.broadcast.previewError"));
        return;
      }
      setPreview(data);
      setStep("preview");
    } catch {
      setError(t("admin.broadcast.sendError"));
    } finally {
      setLoading(false);
    }
  }, [concertId, subject, body, hasAnyFilter, ticketTypeIds, paymentMethodTypes, orderStatuses, refreshToken, t]);

  const handleSend = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/send-broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({
          concertId,
          subject: subject.trim(),
          body: body.trim(),
          filters: { ticketTypeIds, paymentMethodTypes, orderStatuses },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("admin.broadcast.sendCampaignError"));
        return;
      }
      setResult({
        sentCount: data.sentCount,
        failedCount: data.failedCount,
        suppressedCount: data.suppressedCount,
        recipientCount: data.recipientCount,
      });
      setStep("result");
    } catch {
      setError(t("admin.broadcast.sendError"));
    } finally {
      setLoading(false);
    }
  }, [concertId, subject, body, ticketTypeIds, paymentMethodTypes, orderStatuses, refreshToken, t]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-background border border-border rounded-2xl w-full max-w-2xl my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background z-10">
          <h2 className="text-lg font-semibold">
            {step === "compose" && t("admin.broadcast.newCampaign")}
            {step === "preview" && t("admin.broadcast.confirmRecipients")}
            {step === "result" && t("admin.broadcast.campaignSent")}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground p-1"
            aria-label={t("common.close")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step 1: Compose */}
        {step === "compose" && (
          <div className="p-6 space-y-5">
            {/* Event */}
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                {t("admin.broadcast.event")}
              </label>
              <select
                value={concertId}
                onChange={(e) => {
                  setConcertId(e.target.value);
                  setTicketTypeIds([]);
                  setPaymentMethodTypes([]);
                }}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
              >
                {concerts.length === 0 && <option value="">{t("admin.broadcast.noEvents")}</option>}
                {concerts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Subject */}
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                {t("admin.broadcast.subject")}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={SUBJECT_MAX}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder={t("admin.broadcast.subjectPlaceholder")}
              />
              <p className="text-right text-xs text-muted mt-1">{subject.length}/{SUBJECT_MAX}</p>
            </div>

            {/* Body */}
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                {t("admin.broadcast.message")}
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={BODY_MAX}
                rows={6}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm resize-y"
                placeholder={t("admin.broadcast.bodyPlaceholder")}
              />
              <p className="text-right text-xs text-muted mt-1">{body.length}/{BODY_MAX}</p>
            </div>

            {/* Filters */}
            <div className="space-y-4 pt-2 border-t border-border">
              <p className="text-sm font-semibold">{t("admin.broadcast.filterRecipients")}</p>

              <div>
                <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
                  {t("admin.broadcast.orderStatus")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {orderStatusOptions.map((s) => (
                    <Chip
                      key={s.value}
                      active={orderStatuses.includes(s.value)}
                      onClick={() => toggle(orderStatuses, setOrderStatuses)(s.value)}
                    >
                      {s.label}
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
                  {t("admin.broadcast.ticketTypes")} {ticketTypeIds.length === 0 && availableTicketTypes.length > 0 && (
                    <span className="normal-case font-normal text-muted/70">{t("admin.broadcast.all")}</span>
                  )}
                </p>
                {availableTicketTypes.length === 0 ? (
                  <p className="text-xs text-muted">{t("admin.broadcast.noTicketTypesForEvent")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableTicketTypes.map((tt) => (
                      <Chip
                        key={tt.id}
                        active={ticketTypeIds.includes(tt.id)}
                        onClick={() => toggle(ticketTypeIds, setTicketTypeIds)(tt.id)}
                      >
                        {tt.name}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
                  {t("admin.broadcast.paymentMethods")} {paymentMethodTypes.length === 0 && paymentMethodOptions.length > 0 && (
                    <span className="normal-case font-normal text-muted/70">{t("admin.broadcast.all")}</span>
                  )}
                </p>
                {paymentMethodOptions.length === 0 ? (
                  <p className="text-xs text-muted">{t("admin.broadcast.noPaymentMethodsForEvent")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {paymentMethodOptions.map((pm) => (
                      <Chip
                        key={pm.type}
                        active={paymentMethodTypes.includes(pm.type)}
                        onClick={() => toggle(paymentMethodTypes, setPaymentMethodTypes)(pm.type)}
                      >
                        {pm.count > 1
                          ? t("admin.broadcast.pmAccountsCount", { name: pm.name, count: pm.count })
                          : pm.name}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <button
                onClick={onClose}
                className="px-5 py-2.5 text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleLoadPreview}
                disabled={loading}
                className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 text-sm uppercase tracking-wider"
              >
                {loading ? t("admin.broadcast.loading") : t("admin.broadcast.preview")}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div className="p-6 space-y-5">
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-sm text-muted mb-1">{t("admin.broadcast.willSendTo")}</p>
              <p className="text-4xl font-bold text-accent">{preview.totalCount}</p>
              <p className="text-sm text-muted mt-1">
                {preview.totalCount === 1 ? t("admin.broadcast.recipient") : t("admin.broadcast.recipients")}
              </p>
              {preview.suppressedCount > 0 && (
                <p className="text-xs text-yellow-600 mt-3">
                  {t("admin.broadcast.suppressedExcluded", { count: preview.suppressedCount })}
                </p>
              )}
            </div>

            {preview.totalCount === 0 ? (
              <div className="space-y-3 py-2">
                <p className="text-center text-muted text-sm">
                  {t("admin.broadcast.noMatchesForFilters")}
                </p>
                <div className="bg-surface border border-border rounded-xl p-4">
                  <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
                    {t("admin.broadcast.appliedFilters")}
                  </p>
                  <dl className="space-y-1.5 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-muted min-w-[120px]">{t("admin.broadcast.statusLabel")}:</dt>
                      <dd>
                        {orderStatuses.length === 0
                          ? t("admin.broadcast.allFilter")
                          : orderStatuses
                              .map(
                                (v) =>
                                  orderStatusOptions.find((o) => o.value === v)?.label ?? v,
                              )
                              .join(", ")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-muted min-w-[120px]">{t("admin.broadcast.ticketTypesLabel")}:</dt>
                      <dd>
                        {ticketTypeIds.length === 0
                          ? t("admin.broadcast.allFilter")
                          : ticketTypeIds
                              .map(
                                (id) =>
                                  availableTicketTypes.find((tt) => tt.id === id)?.name ?? id,
                              )
                              .join(", ")}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-muted min-w-[120px]">{t("admin.broadcast.paymentMethodsLabel")}:</dt>
                      <dd>
                        {paymentMethodTypes.length === 0
                          ? t("admin.broadcast.allFilter")
                          : paymentMethodTypes
                              .map(
                                (type) =>
                                  paymentMethodOptions.find((pm) => pm.type === type)?.name ?? type,
                              )
                              .join(", ")}
                      </dd>
                    </div>
                  </dl>
                </div>
                {preview.concertTotalOrderCount !== undefined && (
                  <p className="text-center text-xs text-muted">
                    {preview.concertTotalOrderCount === 0
                      ? t("admin.broadcast.eventNoOrders")
                      : t("admin.broadcast.eventTotalOrders", {
                          count: preview.concertTotalOrderCount,
                        })}
                  </p>
                )}
                {preview.concertTotalOrderCount !== undefined &&
                  preview.concertTotalOrderCount > 0 && (
                    <p className="text-center text-xs text-muted">
                      {t("admin.broadcast.relaxFilterHint")}
                    </p>
                  )}
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
                  {t("admin.broadcast.sampleHeader", { shown: preview.sample.length, total: preview.totalCount })}
                </p>
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">{t("admin.broadcast.colName")}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">{t("admin.broadcast.colEmail")}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">{t("admin.broadcast.colTicket")}</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">{t("admin.broadcast.colPayment")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((r) => (
                        <tr key={r.email} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-2">{r.firstName} {r.lastName}</td>
                          <td className="px-3 py-2 text-muted">{r.email}</td>
                          <td className="px-3 py-2 text-muted">{r.ticketTypeName}</td>
                          <td className="px-3 py-2 text-muted">{r.paymentMethod}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex justify-between gap-3 pt-4 border-t border-border">
              <button
                onClick={() => setStep("compose")}
                disabled={loading}
                className="px-5 py-2.5 text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                {t("admin.broadcast.backToEdit")}
              </button>
              <button
                onClick={handleSend}
                disabled={loading || preview.totalCount === 0}
                className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 text-sm uppercase tracking-wider"
              >
                {loading ? t("admin.broadcast.sending") : t("admin.broadcast.sendTo", { count: preview.totalCount })}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === "result" && result && (
          <div className="p-6 space-y-5">
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-lg font-semibold text-green-800">{t("admin.broadcast.campaignSent")}</p>
              <p className="text-sm text-green-700 mt-2">
                {t("admin.broadcast.deliveredOf", { sent: result.sentCount, total: result.recipientCount })}
              </p>
              {result.failedCount > 0 && (
                <p className="text-sm text-red-600 mt-2">
                  {t("admin.broadcast.failedCount", { count: result.failedCount })}
                </p>
              )}
              {result.suppressedCount > 0 && (
                <p className="text-xs text-yellow-700 mt-2">
                  {t("admin.broadcast.suppressedNote", { count: result.suppressedCount })}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors text-sm uppercase tracking-wider"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
