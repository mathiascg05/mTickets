"use client";

import { db } from "@/lib/db";
import { AuthProvider } from "@/lib/AuthContext";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

function LoginForm() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [usesPassword, setUsesPassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), action: mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send code");
      } else {
        setSentTo(email.trim());
        setUsesPassword(!!data.requiresPassword);
      }
    } catch {
      setError("Failed to send code. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    try {
      const body = usesPassword
        ? { email: sentTo, password: password.trim() }
        : { email: sentTo, code: code.trim() };
      const res = await fetch("/api/admin-auth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Verification failed");
      } else {
        db.auth.signInWithToken(data.token);
      }
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResendCode() {
    setError(null);
    setCode("");
    setSending(true);
    try {
      const res = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: sentTo, action: mode }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to resend code");
      }
    } catch {
      setError("Failed to resend code");
    } finally {
      setSending(false);
    }
  }

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    setError(null);
    setSentTo("");
    setCode("");
    setPassword("");
    setUsesPassword(false);
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

        {!sentTo ? (
          <form onSubmit={handleSendCode} className="space-y-4">
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
              disabled={sending}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {sending
                ? "Sending..."
                : mode === "login"
                  ? "Send Login Code"
                  : "Send Verification Code"}
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
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            {usesPassword ? (
              <>
                <p className="text-sm text-muted">
                  Enter password for <strong className="text-foreground">{sentTo}</strong>
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
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Code sent to <strong className="text-foreground">{sentTo}</strong>
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                    placeholder="Enter code"
                  />
                </div>
              </>
            )}
            {error && <p className="text-danger text-sm">{error}</p>}
            <button
              type="submit"
              disabled={verifying}
              className="w-full py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {verifying ? "Verifying..." : usesPassword ? "Log In" : "Verify"}
            </button>
            {!usesPassword && (
              <button
                type="button"
                onClick={handleResendCode}
                className="w-full py-2 text-sm text-accent-light hover:text-accent transition-colors font-medium"
              >
                Resend Code
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSentTo("");
                setCode("");
                setPassword("");
                setUsesPassword(false);
                setError(null);
              }}
              className="w-full py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              Use different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const navItems = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/concerts", label: "Events" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/communications", label: "Messages" },
  { href: "/scan", label: "Scanner" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, user } = db.useAuth();
  const pathname = usePathname();

  const userEmail = user?.email ?? "";

  const { data: userData } = db.useQuery(
    userEmail
      ? { $users: { $: { where: { email: userEmail } } } }
      : null,
  );

  const currentUser = userData?.$users?.[0];
  const userIsSuperAdmin = currentUser?.type === "superadmin" || userEmail === SUPER_ADMIN_EMAIL;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted">Loading...</div>
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
