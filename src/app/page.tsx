"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header (sticky) */}
      <header className="sticky top-0 z-40 bg-accent/90 backdrop-blur-md text-white border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-2xl font-bold tracking-wide">
            ma<span className="text-white/60">Tickets</span>
          </span>
          <LanguageToggle className="border-white/30 text-white/70 hover:text-white" />
        </div>
      </header>

      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-accent text-white">
        {/* Base gradient wash */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-accent-dark via-accent to-accent-light pointer-events-none"
        />
        {/* Aurora orbs */}
        <div
          aria-hidden
          className="absolute -top-40 right-[5%] w-[680px] h-[680px] rounded-full bg-accent-glow/35 blur-[120px] pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute top-1/3 -left-40 w-[560px] h-[560px] rounded-full bg-accent-light/40 blur-[120px] pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute -bottom-48 right-1/4 w-[480px] h-[480px] rounded-full bg-white/[0.06] blur-[100px] pointer-events-none"
        />
        {/* Soft top highlight */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none"
        />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 lg:py-28 grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
          {/* Left column */}
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-glow shadow-[0_0_8px_var(--accent-glow)]" />
              {t("home.heroTag")}
            </span>

            <h1 className="mt-5 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-balance leading-[1.05]">
              {t("home.hero")}
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-white/70 max-w-xl text-balance">
              {t("home.heroSub")}
            </p>

            <div className="mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Link
                href="/admin"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 bg-white text-accent font-semibold rounded-lg shadow-2xl shadow-accent-glow/40 hover:bg-white/95 hover:scale-[1.02] active:scale-100 transition"
              >
                {t("home.ctaPrimary")}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </Link>
              <Link
                href="/admin"
                className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-white/25 text-white font-medium rounded-lg hover:bg-white/5 transition"
              >
                {t("home.organizerLogin")}
              </Link>
            </div>

            <ul className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-white/60">
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                {t("home.trustPayments")}
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                {t("home.trustSetup")}
              </li>
              <li className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.5 2.7L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
                {t("home.trustGA")}
              </li>
            </ul>
          </div>

          {/* Right column — product mockup */}
          <div className="relative w-full max-w-md mx-auto lg:mx-0 lg:ml-auto">
            {/* Currency chip (floating top-left) */}
            <div className="absolute -top-4 -left-2 sm:-left-6 z-20 -rotate-3 bg-surface text-foreground rounded-full shadow-xl px-3 py-1.5 border border-border flex items-center gap-2 text-xs font-medium">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M7 10h14l-3-3M17 14H3l3 3" />
              </svg>
              {t("home.mockupRateChip")}
            </div>

            {/* Dashboard card */}
            <div className="relative bg-surface text-foreground rounded-2xl shadow-2xl shadow-black/40 p-5 sm:p-6 border border-white/10">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent to-accent-light text-white flex items-center justify-center text-sm font-bold">
                    M
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                      {t("admin.dashboard")}
                    </p>
                    <p className="text-sm font-semibold leading-tight">
                      {t("home.mockupSubtitle")}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] px-2 py-0.5 bg-success/10 text-success rounded-full font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  {t("home.mockupActive")}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5 mb-5">
                <div className="bg-background rounded-lg p-2.5">
                  <p className="text-[10px] uppercase text-muted mb-1 font-medium">
                    {t("home.mockupSold")}
                  </p>
                  <p className="text-lg font-bold">1,284</p>
                </div>
                <div className="bg-background rounded-lg p-2.5">
                  <p className="text-[10px] uppercase text-muted mb-1 font-medium">
                    {t("home.mockupRevenue")}
                  </p>
                  <p className="text-lg font-bold">$28.4k</p>
                </div>
                <div className="bg-background rounded-lg p-2.5">
                  <p className="text-[10px] uppercase text-muted mb-1 font-medium">
                    {t("home.mockupPending")}
                  </p>
                  <p className="text-lg font-bold">17</p>
                </div>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase text-muted font-medium mb-1">
                    {t("home.mockupTrendLabel")}
                  </p>
                  <p className="text-xs font-semibold text-success truncate">
                    {t("home.mockupTrend")}
                  </p>
                </div>
                <svg
                  width="120"
                  height="36"
                  viewBox="0 0 120 36"
                  className="text-accent shrink-0"
                  aria-hidden
                >
                  <defs>
                    <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M0 28 L15 24 L30 26 L45 18 L60 20 L75 12 L90 14 L105 6 L120 4 L120 36 L0 36 Z"
                    fill="url(#sparkGrad)"
                  />
                  <path
                    d="M0 28 L15 24 L30 26 L45 18 L60 20 L75 12 L90 14 L105 6 L120 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="120" cy="4" r="3" fill="currentColor" />
                  <circle cx="120" cy="4" r="6" fill="currentColor" fillOpacity="0.2" />
                </svg>
              </div>
            </div>

            {/* Floating ticket card */}
            <div className="absolute -bottom-10 -right-2 sm:-right-8 z-20 rotate-3 bg-surface text-foreground rounded-xl shadow-2xl shadow-black/30 p-3.5 w-56 border border-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] uppercase tracking-wider text-muted font-bold">
                  {t("home.mockupTicketType")}
                </p>
                <span className="text-[10px] text-success font-semibold flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {t("home.mockupApproved")}
                </span>
              </div>
              <div className="bg-background rounded-md p-2 flex items-center justify-center">
                <QRCodeSVG
                  value="https://matickets.net"
                  size={88}
                  bgColor="transparent"
                  fgColor="#1a2b4a"
                  level="L"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value props strip */}
      <section className="bg-background border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <ValueProp
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <circle cx="12" cy="12" r="2.5" />
                  <path d="M6 10v4M18 10v4" />
                </svg>
              }
              title={t("home.vp1Title")}
              desc={t("home.vp1Desc")}
            />
            <ValueProp
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
              title={t("home.vp2Title")}
              desc={t("home.vp2Desc")}
            />
            <ValueProp
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <path d="M14 14h3v3h-3zM21 14v7M14 21h3" />
                </svg>
              }
              title={t("home.vp3Title")}
              desc={t("home.vp3Desc")}
            />
            <ValueProp
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
              title={t("home.vp4Title")}
              desc={t("home.vp4Desc")}
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
            {t("home.howItWorks")}
          </h2>
          <p className="text-muted text-center mb-12 max-w-xl mx-auto">
            {t("home.howItWorksSub")}
          </p>

          <div className="grid sm:grid-cols-3 gap-8">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="bg-surface border border-border rounded-xl p-6 text-center hover:shadow-lg transition-shadow"
              >
                <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl text-accent font-bold">{n}</span>
                </div>
                <h3 className="font-semibold text-lg mb-2">
                  {t(`home.step${n}Title`)}
                </h3>
                <p className="text-muted text-sm">
                  {t(`home.step${n}Desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Attendee banner (closing) */}
      <div className="bg-surface border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 text-sm">
          <div className="flex items-center gap-2.5 text-foreground">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </span>
            <span className="font-medium">{t("home.attendeeBannerTitle")}</span>
          </div>
          <span className="text-muted sm:before:content-['·'] sm:before:mr-3 sm:before:text-border">
            {t("home.attendeeBannerCta")}
          </span>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-accent text-white/60 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-sm space-y-3">
          <p className="font-semibold text-white">
            ma<span className="text-white/60">Tickets</span>
          </p>
          <p>{t("home.footer")}</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
            <Link href="/terms" className="hover:text-white transition-colors">
              Términos
            </Link>
            <span className="text-white/30">·</span>
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacidad
            </Link>
            <span className="text-white/30">·</span>
            <Link
              href="/terminos-organizador"
              className="hover:text-white transition-colors"
            >
              Términos del Organizador
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function ValueProp({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="group">
      <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-accent/10 text-accent mb-4 group-hover:scale-105 transition-transform">
        {icon}
      </div>
      <h3 className="font-semibold text-base mb-1.5">{title}</h3>
      <p className="text-sm text-muted leading-relaxed">{desc}</p>
    </div>
  );
}
