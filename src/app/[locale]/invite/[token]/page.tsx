"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/db";
import { useLanguage } from "@/lib/LanguageContext";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legalVersions";
import { parseBank, formatBank } from "@/lib/pago-movil";
import Link from "next/link";

async function uploadWithRetry(path: string, file: File) {
  try {
    await db.storage.upload(path, file);
  } catch (err) {
    const isIdbClosing =
      err instanceof Error &&
      err.name === "InvalidStateError" &&
      err.message.includes("IDBDatabase");
    if (!isIdbClosing) throw err;
    await new Promise((r) => setTimeout(r, 500));
    await db.storage.upload(path, file);
  }
}

type PaymentMethodPublic = {
  id: string;
  type: string;
  name: string;
  instructions?: string;
  convertCurrency?: string;
  customRate?: number;
  showConversionDetail?: boolean;
  requireScreenshot?: boolean;
  requireReferenceNumber?: boolean;
  zelleEmail?: string;
  zelleName?: string;
  pmCedula?: string;
  pmPhone?: string;
  pmBank?: string;
  feePercent?: number;
  feeFixed?: number;
  sortOrder: number;
};

type CustomFieldPublic = {
  id: string;
  label: string;
  fieldType: string;
  required: boolean;
  options?: string;
  sortOrder: number;
};

type RedeemData = {
  status: "invited" | "registered";
  orderToken?: string;
  entry?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    cedula: string;
    finalPrice: number;
    basePrice?: number;
    feeAmount?: number;
    feePercent?: number;
    feeFixed?: number;
    hasOverride?: boolean;
    ticketType?: { id: string; name: string; description?: string } | null;
  };
  event?: {
    id: string;
    name: string;
    slug: string;
    date: string;
    venue: string;
    venueMapUrl: string;
    description: string;
    flyerUrl: string;
    flyerPath: string;
    logoUrl: string;
    logoPath: string;
    primaryColor: string;
    organizerEmail: string;
    feeMode?: string;
  };
  paymentMethods?: PaymentMethodPublic[];
  customFields?: CustomFieldPublic[];
};

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token, locale } = use(params);
  const { t } = useLanguage();
  const router = useRouter();
  const [data, setData] = useState<RedeemData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentMethodLegacy, setPaymentMethodLegacy] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await fetch(`/api/guest-list/redeem/${token}`);
        const body = await res.json();
        if (abort) return;
        if (!res.ok) {
          setError(body.error || "Error");
          return;
        }
        if (body.status === "registered" && body.orderToken) {
          router.replace(`/${locale}/guest-ticket/${body.orderToken}`);
          return;
        }
        setData(body);
      } catch (err) {
        if (!abort) setError(String(err));
      }
    })();
    return () => {
      abort = true;
    };
  }, [token, locale, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm w-full text-center">
          <p className="text-danger font-semibold">{error}</p>
          <p className="text-muted text-sm mt-2">{t("guestList.inviteErrorHelp")}</p>
        </div>
      </div>
    );
  }

  if (!data || !data.entry || !data.event) {
    return <div className="min-h-screen flex items-center justify-center text-muted">{t("common.loading")}</div>;
  }

  const { entry, event } = data;
  const isFree = entry.finalPrice === 0;
  const primary = event.primaryColor;
  const paymentMethods = data.paymentMethods || [];
  const customFields = data.customFields || [];
  const selectedPm = paymentMethods.find((m) => m.id === paymentMethodId);
  const feeMode = event.feeMode === "paymentMethod" ? "paymentMethod" : "ticketType";
  const pmFeeAmount =
    feeMode === "paymentMethod" &&
    !isFree &&
    !entry.hasOverride &&
    typeof entry.basePrice === "number" &&
    selectedPm
      ? (entry.basePrice * (selectedPm.feePercent ?? 0)) / 100 +
        (selectedPm.feeFixed ?? 0)
      : 0;
  const displayTotal = Math.round((entry.finalPrice + pmFeeAmount) * 100) / 100;
  const displayFeeAmount =
    Math.round(((entry.feeAmount ?? 0) + pmFeeAmount) * 100) / 100;

  async function uploadProof(file: File): Promise<string | null> {
    const ts = Date.now();
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `payment-proofs/${ts}-${safe}`;
    try {
      await uploadWithRetry(path, file);
      return path;
    } catch (err) {
      console.error("[invite] proof upload failed:", err);
      return null;
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitError(null);

    if (!isFree) {
      if (paymentMethods.length > 0) {
        if (!paymentMethodId) {
          setSubmitError(t("guestList.needPaymentMethod"));
          return;
        }
        if (selectedPm?.requireScreenshot !== false && !proofFile) {
          setSubmitError(t("guestList.needProof"));
          return;
        }
        if (selectedPm?.requireReferenceNumber === true && !referenceNumber.trim()) {
          setSubmitError(t("guestList.needRef"));
          return;
        }
      } else {
        if (!paymentMethodLegacy.trim()) {
          setSubmitError(t("guestList.needPaymentMethod"));
          return;
        }
        if (!proofFile && !referenceNumber.trim()) {
          setSubmitError(t("guestList.needProofOrRef"));
          return;
        }
      }
    }
    for (const cf of customFields) {
      if (cf.required && !(customFieldValues[cf.id] || "").trim()) {
        setSubmitError(t("guestList.cfRequired", { label: cf.label }));
        return;
      }
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      setSubmitError(t("guestList.mustAccept"));
      return;
    }

    setSubmitting(true);
    try {
      let proofPath: string | undefined;
      if (proofFile) {
        const p = await uploadProof(proofFile);
        if (!p) {
          setSubmitError(t("guestList.uploadFailed"));
          setSubmitting(false);
          return;
        }
        proofPath = p;
      }

      const cfPayload = customFields
        .filter((cf) => customFieldValues[cf.id])
        .reduce<Record<string, string>>((acc, cf) => {
          acc[cf.label] = customFieldValues[cf.id];
          return acc;
        }, {});
      const res = await fetch("/api/guest-list/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteToken: token,
          paymentMethodId: paymentMethodId || undefined,
          paymentMethod: paymentMethodId ? undefined : paymentMethodLegacy || undefined,
          referenceNumber: referenceNumber || undefined,
          paymentProofPath: proofPath,
          customFieldValues:
            Object.keys(cfPayload).length > 0 ? JSON.stringify(cfPayload) : undefined,
          acceptedTermsVersion: TERMS_VERSION,
          acceptedPrivacyVersion: PRIVACY_VERSION,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.error || "Error");
        return;
      }
      router.push(`/${locale}/guest-ticket/${body.orderToken}`);
    } catch (err) {
      setSubmitError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="max-w-md mx-auto space-y-5">
        {event.flyerUrl && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ boxShadow: `0 8px 28px ${primary}33` }}
          >
            <img src={event.flyerUrl} alt={event.name} className="w-full" />
          </div>
        )}
        <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider" style={{ color: primary }}>
              {t("guestList.inviteEyebrow")}
            </p>
            <h1 className="text-2xl font-bold mt-1">{event.name}</h1>
            <p className="text-sm text-muted mt-1">
              {event.date}
              {event.venue ? ` · ${event.venue}` : ""}
            </p>
            {event.venueMapUrl && (
              <a
                href={event.venueMapUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline mt-1 inline-block"
                style={{ color: primary }}
              >
                {t("guestList.viewMap")}
              </a>
            )}
          </div>
          {event.description && (
            <p className="text-sm text-muted whitespace-pre-line">{event.description}</p>
          )}
          <div
            className="rounded-xl p-4 border"
            style={{
              borderColor: `${primary}40`,
              background: `linear-gradient(135deg, ${primary}10, ${primary}05)`,
            }}
          >
            {entry.ticketType && (
              <div className="mb-2">
                <p className="text-xs uppercase tracking-wide text-muted">
                  {t("guestList.colTicketType")}
                </p>
                <p className="text-base font-semibold mt-0.5">
                  {entry.ticketType.name}
                </p>
                {entry.ticketType.description && (
                  <p className="text-xs text-muted mt-0.5">
                    {entry.ticketType.description}
                  </p>
                )}
              </div>
            )}
            <p className="text-xs uppercase tracking-wide text-muted">
              {t("guestList.yourPrice")}
            </p>
            <p className="text-3xl font-bold mt-1" style={{ color: primary }}>
              {isFree ? t("guestList.cortesia") : `$${displayTotal.toFixed(2)}`}
            </p>
            {!isFree &&
              !entry.hasOverride &&
              displayFeeAmount > 0 &&
              typeof entry.basePrice === "number" && (
                <p className="text-xs text-muted mt-1">
                  ${entry.basePrice.toFixed(2)} + $
                  {displayFeeAmount.toFixed(2)}{" "}
                  {t("admin.serviceFees").toLowerCase()}
                </p>
              )}
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-surface border border-border rounded-2xl p-6 space-y-4"
        >
          <p className="text-sm font-semibold">{t("guestList.confirmDetails")}</p>
          <div className="grid grid-cols-2 gap-3">
            <ReadOnlyField label={t("guestList.colName")} value={entry.firstName || "—"} />
            <ReadOnlyField label={t("guestList.colLastName")} value={entry.lastName || "—"} />
          </div>
          <ReadOnlyField label={t("guestList.colEmail")} value={entry.email || "—"} />
          <ReadOnlyField label={t("guestList.colCedula")} value={entry.cedula || "—"} />

          {customFields.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-xs font-semibold text-muted uppercase">
                {t("guestList.cfSectionTitle")}
              </p>
              {customFields.map((cf) => (
                <CustomFieldInput
                  key={cf.id}
                  field={cf}
                  value={customFieldValues[cf.id] || ""}
                  onChange={(v) =>
                    setCustomFieldValues((prev) => ({ ...prev, [cf.id]: v }))
                  }
                />
              ))}
            </div>
          )}

          {!isFree && (
            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-xs font-semibold text-muted uppercase">
                {t("guestList.paymentSectionTitle")}
              </p>
              {paymentMethods.length > 0 ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted uppercase mb-1.5">
                      {t("guestList.paymentMethod")}
                    </label>
                    <select
                      required
                      value={paymentMethodId}
                      onChange={(e) => setPaymentMethodId(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    >
                      <option value="">{t("guestList.selectMethod")}</option>
                      {paymentMethods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedPm && (
                    <PaymentMethodDetails method={selectedPm} primary={primary} />
                  )}
                  {selectedPm?.requireReferenceNumber && (
                    <div>
                      <label className="block text-xs font-medium text-muted uppercase mb-1.5">
                        {t("guestList.referenceNumber")}
                      </label>
                      <input
                        value={referenceNumber}
                        onChange={(e) => setReferenceNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                      />
                    </div>
                  )}
                  {selectedPm && selectedPm.requireScreenshot !== false && (
                    <div>
                      <label className="block text-xs font-medium text-muted uppercase mb-1.5">
                        {t("guestList.paymentProof")}
                      </label>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                        className="block w-full text-sm file:mr-4 file:px-3 file:py-1.5 file:rounded-lg file:bg-background file:border file:border-border file:font-medium"
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-muted uppercase mb-1.5">
                      {t("guestList.paymentMethod")}
                    </label>
                    <input
                      required
                      value={paymentMethodLegacy}
                      onChange={(e) => setPaymentMethodLegacy(e.target.value)}
                      placeholder={t("guestList.paymentMethodPlaceholder")}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted uppercase mb-1.5">
                      {t("guestList.referenceNumber")}
                    </label>
                    <input
                      value={referenceNumber}
                      onChange={(e) => setReferenceNumber(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted uppercase mb-1.5">
                      {t("guestList.paymentProof")}
                    </label>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setProofFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm file:mr-4 file:px-3 file:py-1.5 file:rounded-lg file:bg-background file:border file:border-border file:font-medium"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-2 pt-2 border-t border-border">
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                {t("auth.acceptTerms")}{" "}
                <Link href="/terms" target="_blank" className="underline" style={{ color: primary }}>
                  {t("auth.termsLink")}
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedPrivacy}
                onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                {t("auth.acceptThe")}{" "}
                <Link href="/privacy" target="_blank" className="underline" style={{ color: primary }}>
                  {t("auth.privacyLink")}
                </Link>
              </span>
            </label>
          </div>

          {submitError && <p className="text-sm text-danger">{submitError}</p>}

          <button
            type="submit"
            disabled={submitting}
            style={{ background: primary }}
            className="w-full py-3 text-white rounded-xl font-semibold disabled:opacity-50"
          >
            {submitting
              ? t("common.loading")
              : isFree
                ? t("guestList.confirmEntry")
                : t("guestList.submitPayment")}
          </button>
        </form>
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted uppercase mb-1.5">
        {label}
      </label>
      <input
        readOnly
        value={value}
        className="w-full px-3 py-2 bg-background/50 border border-border rounded-lg text-sm cursor-not-allowed"
      />
    </div>
  );
}

function PaymentMethodDetails({
  method,
  primary,
}: {
  method: PaymentMethodPublic;
  primary: string;
}) {
  return (
    <div
      className="rounded-lg p-3 text-sm space-y-1.5 border"
      style={{
        borderColor: `${primary}30`,
        background: `${primary}08`,
      }}
    >
      {method.type === "zelle" && (
        <>
          {method.zelleEmail && (
            <p>
              <span className="text-muted">Zelle: </span>
              <span className="font-mono select-all">{method.zelleEmail}</span>
            </p>
          )}
          {method.zelleName && (
            <p>
              <span className="text-muted">Nombre: </span>
              <span className="select-all">{method.zelleName}</span>
            </p>
          )}
        </>
      )}
      {method.type === "pago_movil" && (
        <>
          {method.pmCedula && (
            <p>
              <span className="text-muted">Cédula: </span>
              <span className="font-mono select-all">{method.pmCedula}</span>
            </p>
          )}
          {method.pmPhone && (
            <p>
              <span className="text-muted">Teléfono: </span>
              <span className="font-mono select-all">{method.pmPhone}</span>
            </p>
          )}
          {method.pmBank && (
            <p>
              <span className="text-muted">Banco: </span>
              <span className="select-all">{formatBank(parseBank(method.pmBank))}</span>
            </p>
          )}
        </>
      )}
      {method.instructions && (
        <p className="text-muted whitespace-pre-line">{method.instructions}</p>
      )}
    </div>
  );
}

function CustomFieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomFieldPublic;
  value: string;
  onChange: (v: string) => void;
}) {
  const labelEl = (
    <label className="block text-xs font-medium text-muted uppercase mb-1.5">
      {field.label}
      {field.required && <span className="text-danger ml-1">*</span>}
    </label>
  );
  const baseClass =
    "w-full px-3 py-2 bg-background border border-border rounded-lg";

  if (field.fieldType === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={value === "yes" || value === "true" || value === "1"}
          onChange={(e) => onChange(e.target.checked ? "yes" : "")}
        />
        <span>
          {field.label}
          {field.required && <span className="text-danger ml-1">*</span>}
        </span>
      </label>
    );
  }

  if (field.fieldType === "select" || field.fieldType === "multiselect") {
    let opts: string[] = [];
    try {
      opts = field.options ? JSON.parse(field.options) : [];
      if (!Array.isArray(opts)) opts = [];
    } catch {
      opts = (field.options || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
    }
    opts = opts.map((o) => String(o).trim()).filter(Boolean);

    if (field.fieldType === "multiselect") {
      let current: string[] = [];
      try {
        current = value ? JSON.parse(value) : [];
        if (!Array.isArray(current)) current = [];
      } catch {
        current = [];
      }
      function toggle(opt: string) {
        const has = current.includes(opt);
        const next = has ? current.filter((o) => o !== opt) : [...current, opt];
        onChange(JSON.stringify(next));
      }
      return (
        <div>
          {labelEl}
          <div className="flex flex-wrap gap-2">
            {opts.map((o) => {
              const active = current.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    active
                      ? "bg-accent text-white border-accent"
                      : "bg-background border-border text-foreground hover:border-accent/50"
                  }`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div>
        {labelEl}
        <select
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
        >
          <option value="">—</option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const inputType =
    field.fieldType === "number"
      ? "number"
      : field.fieldType === "email"
        ? "email"
        : field.fieldType === "date"
          ? "date"
          : "text";

  return (
    <div>
      {labelEl}
      <input
        type={inputType}
        required={field.required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={baseClass}
      />
    </div>
  );
}
