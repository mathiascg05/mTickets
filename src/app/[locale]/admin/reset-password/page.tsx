"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useLanguage } from "@/lib/LanguageContext";

export default function ResetPasswordPage() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError(t("auth.passwordMin"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.passwordsDiffer"));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/reset-password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("auth.somethingWrong"));
      } else {
        setSuccess(true);
      }
    } catch {
      setError(t("auth.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  if (!email || !token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-sm shadow-lg text-center">
          <h1 className="text-2xl font-bold text-accent mb-2">ma<span className="text-accent/60">Tickets</span></h1>
          <p className="text-danger text-sm mb-4">{t("auth.invalidResetLink")}</p>
          <Link href="/admin" className="text-accent-light hover:text-accent font-medium transition-colors text-sm">
            {t("auth.backToLogin")}
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-sm shadow-lg text-center">
          <h1 className="text-2xl font-bold text-accent mb-2">ma<span className="text-accent/60">Tickets</span></h1>
          <p className="text-sm text-foreground mb-4">{t("auth.resetSuccess")}</p>
          <Link
            href="/admin"
            className="inline-block w-full py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-center"
          >
            {t("auth.login")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-sm shadow-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-accent">ma<span className="text-accent/60">Tickets</span></h1>
          <p className="text-sm text-muted mt-1">{t("auth.resetSubtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted">
            {t("auth.newPasswordFor")} <strong className="text-foreground">{email}</strong>
          </p>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t("auth.newPasswordLabel")}</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
              placeholder={t("auth.enterNewPassword")}
              minLength={8}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t("auth.confirmPasswordLabel")}</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
              placeholder={t("auth.confirmNewPassword")}
              minLength={8}
            />
          </div>
          {error && <p className="text-danger text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
          >
            {loading ? t("auth.resetting") : t("auth.resetPassword")}
          </button>
          <Link href="/admin" className="block text-center text-sm text-muted hover:text-foreground transition-colors">
            {t("auth.backToLogin")}
          </Link>
        </form>
      </div>
    </div>
  );
}
