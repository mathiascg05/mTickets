"use client";

import { db } from "@/lib/db";
import { AuthProvider } from "@/lib/AuthContext";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

function LoginForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [step, setStep] = useState<"email" | "password" | "forgot" | "resetSent">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
        setError(data.error || "Something went wrong");
      } else {
        setStep("password");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
    }

    setLoading(true);
    try {
      const body =
        mode === "register"
          ? { email: email.trim(), password, confirmPassword, action: "register" }
          : { email: email.trim(), password };
      const res = await fetch("/api/admin-auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Authentication failed");
      } else {
        db.auth.signInWithToken(data.token);
      }
    } catch {
      setError("Authentication failed. Please try again.");
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
        setError(data.error || "Something went wrong");
      } else {
        setStep("resetSent");
      }
    } catch {
      setError("Something went wrong. Please try again.");
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
            {mode === "login" ? "Log In" : "Create Account"}
          </p>
        </div>

        {step === "email" && (
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Email
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
              {loading ? "Loading..." : "Continue"}
            </button>
            <p className="text-center text-sm text-muted">
              {mode === "login" ? (
                <>
                  Don&apos;t have an account?{" "}
                  <button type="button" onClick={switchMode} className="text-accent-light hover:text-accent font-medium transition-colors">
                    Create one
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={switchMode} className="text-accent-light hover:text-accent font-medium transition-colors">
                    Log in
                  </button>
                </>
              )}
            </p>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-sm text-muted">
              {mode === "login" ? "Enter password for" : "Set a password for"}{" "}
              <strong className="text-foreground">{email.trim()}</strong>
            </p>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                placeholder="Enter password"
                minLength={8}
              />
            </div>
            {mode === "register" && (
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                  placeholder="Confirm password"
                  minLength={8}
                />
              </div>
            )}
            {error && <p className="text-danger text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading
                ? "Loading..."
                : mode === "login"
                  ? "Log In"
                  : "Create Account"}
            </button>
            {mode === "login" && (
              <button
                type="button"
                onClick={() => { setStep("forgot"); setError(null); }}
                className="w-full py-2 text-sm text-accent-light hover:text-accent transition-colors font-medium"
              >
                Forgot password?
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
              Use different email
            </button>
          </form>
        )}

        {step === "forgot" && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <p className="text-sm text-muted">
              We&apos;ll send a reset link to <strong className="text-foreground">{email.trim()}</strong>
            </p>
            {error && <p className="text-danger text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
            <button
              type="button"
              onClick={() => { setStep("password"); setError(null); }}
              className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              Back to login
            </button>
          </form>
        )}

        {step === "resetSent" && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-foreground">
              If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a password reset link.
            </p>
            <p className="text-sm text-muted">Check your inbox and follow the link to set a new password.</p>
            <button
              type="button"
              onClick={() => { setStep("email"); setError(null); setPassword(""); }}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors"
            >
              Back to login
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
              View Site
            </Link>
            <button
              onClick={() => db.auth.signOut()}
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Sign Out
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
