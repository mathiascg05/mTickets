"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { isValidName, isValidPhone } from "@/lib/validation";
import PhoneField from "@/components/PhoneField";

/**
 * Blocking gate shown after login when the account is missing the contact
 * details we ask for at registration (firstName / lastName / phone). Accounts
 * created before those fields existed land here; the only way out without
 * filling them in is signing out. Mirrors LegalGate.
 */
export function ContactGate({
  refreshToken,
  onSignOut,
}: {
  refreshToken: string;
  onSignOut: () => void;
}) {
  const { t } = useLanguage();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
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
      }
      // On success the layout's $users query is reactive: it re-renders and
      // drops the gate on its own.
    } catch {
      setError(t("admin.completeContactError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
      >
        <div>
          <h2 className="text-xl font-bold">
            {t("admin.completeContactTitle")}
          </h2>
          <p className="text-sm text-muted mt-1">
            {t("admin.completeContactIntro")}
          </p>
        </div>
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
          <button
            type="button"
            onClick={onSignOut}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            {t("legalGate.signOut")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {saving
              ? t("admin.completeContactSaving")
              : t("admin.completeContactSave")}
          </button>
        </div>
      </form>
    </div>
  );
}
