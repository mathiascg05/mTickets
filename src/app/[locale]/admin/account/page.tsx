"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { ContactForm } from "@/components/ContactForm";
import { toast } from "sonner";

export default function AdminAccountPage() {
  const { email } = useAuthContext();
  const { t } = useLanguage();
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";
  const [sendingReset, setSendingReset] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Own row only — perms allow auth.id == data.id.
  const { data } = db.useQuery(
    email ? { $users: { $: { where: { email } } } } : null,
  );
  const me = data?.$users?.[0];
  const loaded = data?.$users !== undefined;

  async function handlePasswordReset() {
    if (sendingReset) return;
    setSendingReset(true);
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setResetSent(true);
      } else {
        toast.error(t("auth.somethingWrong"));
      }
    } catch {
      toast.error(t("auth.somethingWrong"));
    } finally {
      setSendingReset(false);
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-3xl font-bold mb-2">{t("admin.account")}</h1>
      <p className="text-sm text-muted mb-6">{t("admin.accountDesc")}</p>

      <div className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1.5">
            {t("auth.email")}
          </label>
          <p className="px-4 py-2.5 bg-background border border-border rounded-lg text-muted truncate">
            {email}
          </p>
          <p className="text-xs text-muted mt-1.5">
            {t("admin.accountEmailNote")}
          </p>
        </div>

        {loaded ? (
          <ContactForm
            // Remount once the record arrives so the fields mount pre-filled.
            key={me?.id ?? "empty"}
            initial={{
              firstName: me?.firstName,
              lastName: me?.lastName,
              phone: me?.phone,
            }}
            refreshToken={refreshToken}
            submitLabel={t("common.save")}
            onSaved={() => toast.success(t("admin.accountSaved"))}
          />
        ) : (
          <p className="animate-pulse text-muted text-sm">
            {t("common.loading")}
          </p>
        )}
      </div>

      <div className="bg-surface border border-border rounded-xl p-6 mt-6">
        <h2 className="text-lg font-semibold">
          {t("admin.accountPasswordTitle")}
        </h2>
        <p className="text-sm text-muted mt-1">
          {t("admin.accountPasswordDesc")}
        </p>
        {resetSent ? (
          <p className="text-sm text-success mt-3">
            {t("admin.accountPasswordSent")}
          </p>
        ) : (
          <button
            type="button"
            onClick={handlePasswordReset}
            disabled={sendingReset}
            className="mt-3 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-background disabled:opacity-50 transition-colors"
          >
            {sendingReset
              ? t("admin.completeContactSaving")
              : t("admin.accountPasswordButton")}
          </button>
        )}
      </div>
    </div>
  );
}
