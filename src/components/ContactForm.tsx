"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { isValidName, isValidPhone } from "@/lib/validation";
import PhoneField from "@/components/PhoneField";

export type ContactValues = {
  firstName?: string;
  lastName?: string;
  phone?: string;
};

/**
 * Name / last name / phone form backed by POST /api/organizer-contact — the
 * only writable path for $users contact fields (perms block client writes).
 * Shared by the blocking ContactGate and the /admin/account page.
 *
 * `key` it on the loaded record when the initial values arrive asynchronously,
 * so the fields mount already filled.
 */
export function ContactForm({
  initial,
  refreshToken,
  submitLabel,
  footerLeft,
  onSaved,
}: {
  initial?: ContactValues;
  refreshToken: string;
  submitLabel?: string;
  /** Rendered on the left of the footer row (e.g. the gate's sign-out button). */
  footerLeft?: React.ReactNode;
  onSaved?: () => void;
}) {
  const { t } = useLanguage();
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);
    if (!isValidName(firstName) || !isValidName(lastName)) {
      setError(t("auth.nameRequired"));
      return;
    }
    if (!isValidPhone(phone)) {
      setError(t("auth.phoneRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/organizer-contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || t("admin.completeContactError"));
        return;
      }
      onSaved?.();
    } catch {
      setError(t("admin.completeContactError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("auth.firstName")}
          </label>
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
            placeholder={t("auth.firstNamePlaceholder")}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("auth.lastName")}
          </label>
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
            placeholder={t("auth.lastNamePlaceholder")}
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5">
          {t("auth.phoneLabel")}
        </label>
        <PhoneField value={phone} onChange={setPhone} />
      </div>
      {error && <p className="text-danger text-sm">{error}</p>}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div>{footerLeft}</div>
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
        >
          {saving
            ? t("admin.completeContactSaving")
            : (submitLabel ?? t("admin.completeContactSave"))}
        </button>
      </div>
    </form>
  );
}
