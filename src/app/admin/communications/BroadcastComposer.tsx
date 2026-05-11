"use client";

import { useState, useMemo, useCallback } from "react";

type TicketType = { id: string; name: string };
type PaymentMethod = { id: string; type: string; name: string };

const ORDER_STATUSES: { value: string; label: string }[] = [
  { value: "approved", label: "Aprobada" },
  { value: "pending", label: "Pendiente" },
  { value: "rejected", label: "Rechazada" },
  { value: "cancelled", label: "Cancelada" },
];

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

  // Deduplicate payment method types (an event may have multiple PM rows of same type)
  const paymentMethodOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const pm of availablePaymentMethods) {
      if (!seen.has(pm.type)) seen.set(pm.type, pm.name || pm.type);
    }
    return Array.from(seen, ([type, name]) => ({ type, name }));
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
      setError("Selecciona un evento.");
      return;
    }
    if (!subject.trim() || subject.length > SUBJECT_MAX) {
      setError(`Asunto requerido (máx ${SUBJECT_MAX} caracteres).`);
      return;
    }
    if (!body.trim() || body.length > BODY_MAX) {
      setError(`Mensaje requerido (máx ${BODY_MAX} caracteres).`);
      return;
    }
    if (!hasAnyFilter) {
      setError("Selecciona al menos un filtro.");
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
        setError(data.error || "No se pudo cargar la vista previa.");
        return;
      }
      setPreview(data);
      setStep("preview");
    } catch {
      setError("Algo salió mal. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [concertId, subject, body, hasAnyFilter, ticketTypeIds, paymentMethodTypes, orderStatuses, refreshToken]);

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
        setError(data.error || "No se pudo enviar la campaña.");
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
      setError("Algo salió mal. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [concertId, subject, body, ticketTypeIds, paymentMethodTypes, orderStatuses, refreshToken]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-background border border-border rounded-2xl w-full max-w-2xl my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-background z-10">
          <h2 className="text-lg font-semibold">
            {step === "compose" && "Nueva campaña"}
            {step === "preview" && "Confirmar destinatarios"}
            {step === "result" && "Campaña enviada"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground p-1"
            aria-label="Cerrar"
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
                Evento
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
                {concerts.length === 0 && <option value="">No hay eventos disponibles</option>}
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
                Asunto
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={SUBJECT_MAX}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm"
                placeholder="Información importante sobre el evento"
              />
              <p className="text-right text-xs text-muted mt-1">{subject.length}/{SUBJECT_MAX}</p>
            </div>

            {/* Body */}
            <div>
              <label className="block text-[11px] font-medium text-muted uppercase tracking-widest mb-1.5">
                Mensaje
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={BODY_MAX}
                rows={6}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-md focus:outline-none focus:border-accent-light transition-colors text-sm resize-y"
                placeholder="Escribe tu mensaje aquí..."
              />
              <p className="text-right text-xs text-muted mt-1">{body.length}/{BODY_MAX}</p>
            </div>

            {/* Filters */}
            <div className="space-y-4 pt-2 border-t border-border">
              <p className="text-sm font-semibold">Filtrar destinatarios</p>

              <div>
                <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
                  Estado de orden
                </p>
                <div className="flex flex-wrap gap-2">
                  {ORDER_STATUSES.map((s) => (
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
                  Tipos de entrada {ticketTypeIds.length === 0 && availableTicketTypes.length > 0 && (
                    <span className="normal-case font-normal text-muted/70">(todos)</span>
                  )}
                </p>
                {availableTicketTypes.length === 0 ? (
                  <p className="text-xs text-muted">El evento no tiene tipos de entrada.</p>
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
                  Métodos de pago {paymentMethodTypes.length === 0 && paymentMethodOptions.length > 0 && (
                    <span className="normal-case font-normal text-muted/70">(todos)</span>
                  )}
                </p>
                {paymentMethodOptions.length === 0 ? (
                  <p className="text-xs text-muted">El evento no tiene métodos de pago.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {paymentMethodOptions.map((pm) => (
                      <Chip
                        key={pm.type}
                        active={paymentMethodTypes.includes(pm.type)}
                        onClick={() => toggle(paymentMethodTypes, setPaymentMethodTypes)(pm.type)}
                      >
                        {pm.name}
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
                Cancelar
              </button>
              <button
                onClick={handleLoadPreview}
                disabled={loading}
                className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 text-sm uppercase tracking-wider"
              >
                {loading ? "Cargando..." : "Vista previa"}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === "preview" && preview && (
          <div className="p-6 space-y-5">
            <div className="bg-surface border border-border rounded-xl p-6 text-center">
              <p className="text-sm text-muted mb-1">Se enviará a</p>
              <p className="text-4xl font-bold text-accent">{preview.totalCount}</p>
              <p className="text-sm text-muted mt-1">
                {preview.totalCount === 1 ? "destinatario" : "destinatarios"}
              </p>
              {preview.suppressedCount > 0 && (
                <p className="text-xs text-yellow-600 mt-3">
                  {preview.suppressedCount} email(s) excluido(s) por estar en la lista de supresión.
                </p>
              )}
            </div>

            {preview.totalCount === 0 ? (
              <p className="text-center text-muted text-sm py-4">
                Ningún asistente coincide con los filtros seleccionados.
              </p>
            ) : (
              <div>
                <p className="text-[11px] font-medium text-muted uppercase tracking-widest mb-2">
                  Muestra (primeros {preview.sample.length} de {preview.totalCount})
                </p>
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-background border-b border-border">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">Nombre</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">Email</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">Entrada</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted uppercase tracking-widest">Pago</th>
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
                ← Volver a editar
              </button>
              <button
                onClick={handleSend}
                disabled={loading || preview.totalCount === 0}
                className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors disabled:opacity-50 text-sm uppercase tracking-wider"
              >
                {loading ? "Enviando..." : `Enviar a ${preview.totalCount}`}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Result */}
        {step === "result" && result && (
          <div className="p-6 space-y-5">
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-lg font-semibold text-green-800">Campaña enviada</p>
              <p className="text-sm text-green-700 mt-2">
                {result.sentCount} de {result.recipientCount} correos entregados
              </p>
              {result.failedCount > 0 && (
                <p className="text-sm text-red-600 mt-2">
                  {result.failedCount} fallaron al enviarse
                </p>
              )}
              {result.suppressedCount > 0 && (
                <p className="text-xs text-yellow-700 mt-2">
                  {result.suppressedCount} email(s) excluido(s) por la lista de supresión.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-md font-medium transition-colors text-sm uppercase tracking-wider"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
