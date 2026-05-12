"use client";

import { db } from "@/lib/db";
import { AuthProvider } from "@/lib/AuthContext";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import {
  TERMS_VERSION,
  ORGANIZER_TERMS_VERSION,
  PRIVACY_VERSION,
} from "@/lib/legalVersions";
import { LegalGate, hasAcceptedCurrentLegalTerms } from "@/components/LegalGate";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

function LoginForm() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"email" | "password" | "forgot" | "resetSent">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedOrganizerTerms, setAcceptedOrganizerTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), action: mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("auth.somethingWrong"));
      } else {
        setStep("password");
      }
    } catch {
      setError(t("auth.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (password.length < 8) {
        setError(t("auth.passwordMin"));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("auth.passwordsDiffer"));
        return;
      }
      if (!acceptedTerms || !acceptedOrganizerTerms || !acceptedPrivacy) {
        setError(t("auth.mustAcceptTerms"));
        return;
      }
    }

    setLoading(true);
    try {
      const body =
        mode === "register"
          ? {
              email: email.trim(),
              password,
              confirmPassword,
              action: "register",
              acceptedTermsVersion: TERMS_VERSION,
              acceptedOrganizerTermsVersion: ORGANIZER_TERMS_VERSION,
              acceptedPrivacyVersion: PRIVACY_VERSION,
            }
          : { email: email.trim(), password };
      const res = await fetch("/api/admin-auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("auth.authFailed"));
      } else {
        db.auth.signInWithToken(data.token);
      }
    } catch {
      setError(t("auth.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    setError(null);
    setStep("email");
    setPassword("");
    setConfirmPassword("");
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("auth.somethingWrong"));
      } else {
        setStep("resetSent");
      }
    } catch {
      setError(t("auth.somethingWrong"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="bg-surface border border-border rounded-2xl p-8 w-full max-w-sm shadow-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-accent">ma<span className="text-accent/60">Tickets</span></h1>
          <p className="text-sm text-muted mt-1">
            {mode === "login" ? t("auth.login") : t("auth.createAccount")}
          </p>
        </div>

        {step === "email" && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("auth.email")}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                placeholder="you@email.com"
              />
            </div>
            {error && <p className="text-danger text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? t("common.loading") : t("auth.continue")}
            </button>
            <p className="text-center text-sm text-muted">
              {mode === "login" ? (
                <>
                  {t("auth.noAccount")}{" "}
                  <button type="button" onClick={switchMode} className="text-accent-light hover:text-accent font-medium transition-colors">
                    {t("auth.createOne")}
                  </button>
                </>
              ) : (
                <>
                  {t("auth.haveAccount")}{" "}
                  <button type="button" onClick={switchMode} className="text-accent-light hover:text-accent font-medium transition-colors">
                    {t("auth.login")}
                  </button>
                </>
              )}
            </p>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-sm text-muted">
              {mode === "login" ? t("auth.enterPasswordFor") : t("auth.setPasswordFor")}{" "}
              <strong className="text-foreground">{email.trim()}</strong>
            </p>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("auth.password")}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                placeholder={t("auth.enterPassword")}
                minLength={8}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  {t("auth.confirmPasswordLabel")}
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                  placeholder={t("auth.confirmPassword")}
                  minLength={8}
                />
              </div>
            )}
            {mode === "register" && (
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    className="mt-0.5 accent-accent-light"
                  />
                  <span>
                    {t("auth.acceptTerms")}{" "}
                    <Link
                      href="/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-light hover:text-accent underline"
                    >
                      {t("auth.termsLink")}
                    </Link>
                    .
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedOrganizerTerms}
                    onChange={(e) => setAcceptedOrganizerTerms(e.target.checked)}
                    className="mt-0.5 accent-accent-light"
                  />
                  <span>
                    {t("auth.acceptTerms")}{" "}
                    <Link
                      href="/terminos-organizador"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-light hover:text-accent underline"
                    >
                      {t("auth.organizerTermsLink")}
                    </Link>
                    {t("auth.organizerTermsExtra")}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedPrivacy}
                    onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                    className="mt-0.5 accent-accent-light"
                  />
                  <span>
                    {t("auth.acceptThe")}{" "}
                    <Link
                      href="/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent-light hover:text-accent underline"
                    >
                      {t("auth.privacyLink")}
                    </Link>
                    .
                  </span>
                </label>
              </div>
            )}
            {error && <p className="text-danger text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading
                ? t("common.loading")
                : mode === "login"
                  ? t("auth.login")
                  : t("auth.createAccount")}
            </button>
            {mode === "login" && (
              <button
                type="button"
                onClick={() => { setStep("forgot"); setError(null); }}
                className="w-full py-2 text-sm text-accent-light hover:text-accent transition-colors font-medium"
              >
                {t("auth.forgot")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setPassword("");
                setConfirmPassword("");
                setError(null);
              }}
              className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              {t("auth.useDifferentEmail")}
            </button>
          </form>
        )}

        {step === "forgot" && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <p className="text-sm text-muted">
              {t("auth.willSendResetTo", { email: email.trim() })}
            </p>
            {error && <p className="text-danger text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? t("auth.sending") : t("auth.sendResetLink")}
            </button>
            <button
              type="button"
              onClick={() => { setStep("password"); setError(null); }}
              className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              {t("auth.backToLogin")}
            </button>
          </form>
        )}

        {step === "resetSent" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-foreground">
              {t("auth.resetSentLine1", { email: email.trim() })}
            </p>
            <p className="text-sm text-muted">{t("auth.resetSentLine2")}</p>
            <button
              type="button"
              onClick={() => { setStep("email"); setError(null); setPassword(""); }}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
            >
              {t("auth.backToLogin")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, user } = db.useAuth();
  const pathname = usePathname();
  const { t } = useLanguage();

  const userEmail = user?.email ?? "";

  const { data: userData } = db.useQuery(
    userEmail
      ? { $users: { $: { where: { email: userEmail } } } }
      : null,
  );

  const currentUser = userData?.$users?.[0];
  const userIsSuperAdmin = currentUser?.type === "superadmin" || userEmail === SUPER_ADMIN_EMAIL;
  const hasAcceptedLegal = hasAcceptedCurrentLegalTerms(currentUser);
  const refreshToken = (user as { refresh_token?: string } | null)?.refresh_token ?? "";

  const navItems = [
    { href: "/admin", label: t("admin.dashboard") },
    { href: "/admin/concerts", label: t("admin.events") },
    { href: "/admin/orders", label: t("admin.orders") },
    { href: "/admin/communications", label: t("admin.messages") },
    ...(userIsSuperAdmin
      ? [{ href: "/admin/balances", label: t("admin.balances") }]
      : []),
    { href: "/scan", label: t("admin.scanner") },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      </div>
    );
  }

  if (!user || !userEmail) {
    return <LoginForm />;
  }

  // Wait for the user record before deciding on legal gate to avoid flicker.
  const userRecordLoaded = userData?.$users !== undefined && currentUser !== undefined;

  if (userRecordLoaded && !hasAcceptedLegal) {
    return (
      <LegalGate
        refreshToken={refreshToken}
        onAccepted={() => {
          // The $users query is reactive; acceptance will re-render automatically.
        }}
        onSignOut={() => db.auth.signOut()}
      />
    );
  }

  return (
    <AuthProvider value={{ email: userEmail, isSuperAdmin: userIsSuperAdmin }}>
    <div className="min-h-screen bg-background">
      <header className="bg-accent text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-0 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/admin" className="text-xl font-bold tracking-wide py-4">
              ma<span className="text-white/60">Tickets</span>
            </Link>
            <nav className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-4 text-sm font-medium transition-colors border-b-2 ${
                    pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href))
                      ? "border-white text-white"
                      : "border-transparent text-white/60 hover:text-white hover:border-white/40"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <LanguageToggle className="border-white/30 text-white/70 hover:text-white" />
            <Link
              href="/"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              {t("admin.viewSite")}
            </Link>
            <button
              onClick={() => db.auth.signOut()}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              {t("admin.signOut")}
            </button>
          </div>
        </div>
        <nav className="sm:hidden bg-accent-dark px-4 py-2 flex gap-1 overflow-x-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href))
                  ? "bg-white/20 text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
    </AuthProvider>
  );
}
