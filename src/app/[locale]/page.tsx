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
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/admin"
              className="hidden sm:inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-accent text-sm font-semibold rounded-lg hover:bg-white/95 transition"
            >
              {t("home.headerCta")}
            </Link>
            <LanguageToggle className="border-white/30 text-white/70 hover:text-white" />
          </div>
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

      {/* Trust band — honest guarantees, no vanity metrics */}
      <section className="bg-accent-dark/[0.04] border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 text-sm text-muted">
            {[
              t("home.tb1"),
              t("home.tb2"),
              t("home.tb3"),
              t("home.tb4"),
            ].map((label) => (
              <li key={label} className="flex items-center gap-2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success shrink-0">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="font-medium text-foreground/80">{label}</span>
              </li>
            ))}
          </ul>
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

      <main className="flex-1">
        {/* Organizer journey — how it works, from the organizer's side */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
            {t("home.orgJourneyTitle")}
          </h2>
          <p className="text-muted text-center mb-12 max-w-xl mx-auto">
            {t("home.orgJourneySub")}
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
                  {t(`home.orgStep${n}Title`)}
                </h3>
                <p className="text-muted text-sm">
                  {t(`home.orgStep${n}Desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Feature deep-dive — alternating rows */}
        <div className="bg-background border-y border-border">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
              {t("home.featuresTitle")}
            </h2>
            <p className="text-muted text-center mb-14 max-w-xl mx-auto">
              {t("home.featuresSub")}
            </p>

            <div className="space-y-16 sm:space-y-24">
              <FeatureRow
                tag={t("home.feature1Tag")}
                title={t("home.feature1Title")}
                desc={t("home.feature1Desc")}
                visual={<SalesVisual t={t} />}
              />
              <FeatureRow
                reverse
                tag={t("home.feature2Tag")}
                title={t("home.feature2Title")}
                desc={t("home.feature2Desc")}
                visual={<PaymentVisual t={t} />}
              />
              <FeatureRow
                tag={t("home.feature3Tag")}
                title={t("home.feature3Title")}
                desc={t("home.feature3Desc")}
                visual={<ScannerVisual t={t} />}
              />
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">
            {t("home.faqTitle")}
          </h2>
          <div className="divide-y divide-border border-y border-border">
            {[1, 2, 3, 4, 5].map((n) => (
              <details key={n} className="group py-4">
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-foreground marker:hidden">
                  {t(`home.faqQ${n}`)}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted shrink-0 transition-transform group-open:rotate-45"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="mt-3 text-muted text-sm leading-relaxed pr-8">
                  {t(`home.faqA${n}`)}
                </p>
              </details>
            ))}
          </div>
        </div>
      </main>

      {/* Closing CTA */}
      <section className="relative isolate overflow-hidden bg-accent text-white">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-accent-dark to-accent pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute -top-24 left-1/3 w-[520px] h-[520px] rounded-full bg-accent-glow/25 blur-[120px] pointer-events-none"
        />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-balance">
            {t("home.ctaFinalTitle")}
          </h2>
          <p className="mt-4 text-lg text-white/70 max-w-xl mx-auto text-balance">
            {t("home.ctaFinalSub")}
          </p>
          <Link
            href="/admin"
            className="mt-9 inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-accent font-semibold rounded-lg shadow-2xl shadow-accent-glow/40 hover:bg-white/95 hover:scale-[1.02] active:scale-100 transition"
          >
            {t("home.ctaPrimary")}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-accent text-white/60 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {/* Attendee helper (secondary) */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-3 text-sm text-center pb-6 mb-6 border-b border-white/10">
            <span className="flex items-center gap-2 text-white/80">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              {t("home.attendeeBannerTitle")}
            </span>
            <span className="text-white/50 sm:before:content-['·'] sm:before:mr-3">
              {t("home.attendeeBannerCta")}
            </span>
          </div>

          <div className="text-center text-sm space-y-3">
          <p className="font-semibold text-white">
            ma<span className="text-white/60">Tickets</span>
          </p>
          <p>{t("home.footer")}</p>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs">
            <Link href="/terms" className="hover:text-white transition-colors">
              {t("home.footerTerms")}
            </Link>
            <span className="text-white/30">·</span>
            <Link href="/privacy" className="hover:text-white transition-colors">
              {t("home.footerPrivacy")}
            </Link>
            <span className="text-white/30">·</span>
            <Link
              href="/terms-organizer"
              className="hover:text-white transition-colors"
            >
              {t("home.footerOrgTerms")}
            </Link>
          </nav>
          </div>
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

function FeatureRow({
  tag,
  title,
  desc,
  visual,
  reverse = false,
}: {
  tag: string;
  title: string;
  desc: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
      <div className={reverse ? "lg:order-2" : ""}>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-accent uppercase tracking-wide">
          {tag}
        </span>
        <h3 className="mt-4 text-2xl sm:text-3xl font-bold tracking-tight text-balance">
          {title}
        </h3>
        <p className="mt-4 text-muted leading-relaxed max-w-lg">{desc}</p>
      </div>
      <div className={reverse ? "lg:order-1" : ""}>{visual}</div>
    </div>
  );
}

/* Stylized product panels (placeholders for real screenshots).
   Swap for <Image> from next/image once captures live in public/landing/. */

function VisualFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-2xl border border-border bg-surface shadow-xl shadow-black/5 p-5 sm:p-6">
      <div className="flex items-center gap-1.5 mb-4">
        <span className="w-2.5 h-2.5 rounded-full bg-border" />
        <span className="w-2.5 h-2.5 rounded-full bg-border" />
        <span className="w-2.5 h-2.5 rounded-full bg-border" />
      </div>
      {children}
    </div>
  );
}

function SalesVisual({ t }: { t: (k: string) => string }) {
  return (
    <VisualFrame>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-background rounded-lg p-3">
          <p className="text-[10px] uppercase text-muted mb-1 font-medium">
            {t("home.mockupSold")}
          </p>
          <p className="text-xl font-bold">1,284</p>
        </div>
        <div className="bg-background rounded-lg p-3">
          <p className="text-[10px] uppercase text-muted mb-1 font-medium">
            {t("home.mockupRevenue")}
          </p>
          <p className="text-xl font-bold">$28.4k</p>
        </div>
        <div className="bg-background rounded-lg p-3">
          <p className="text-[10px] uppercase text-muted mb-1 font-medium">
            {t("home.mockupPending")}
          </p>
          <p className="text-xl font-bold">17</p>
        </div>
      </div>
      <div className="bg-background rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-success">
            {t("home.mockupTrend")}
          </p>
          <span className="text-[10px] px-2 py-0.5 bg-success/10 text-success rounded-full font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            {t("home.mockupActive")}
          </span>
        </div>
        <svg viewBox="0 0 240 60" className="w-full text-accent" aria-hidden>
          <defs>
            <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 48 L30 42 L60 46 L90 30 L120 34 L150 20 L180 24 L210 10 L240 6 L240 60 L0 60 Z"
            fill="url(#salesGrad)"
          />
          <path
            d="M0 48 L30 42 L60 46 L90 30 L120 34 L150 20 L180 24 L210 10 L240 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </VisualFrame>
  );
}

function PaymentVisual({ t }: { t: (k: string) => string }) {
  return (
    <VisualFrame>
      <div className="flex items-center gap-2 mb-4">
        <span className="w-9 h-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <path d="M2 10h20" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight">Pago Móvil</p>
          <p className="text-[11px] text-muted">Ref. 0102 · 04xx</p>
        </div>
        <span className="ml-auto text-[10px] px-2 py-0.5 bg-success/10 text-success rounded-full font-medium flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {t("home.mockupApproved")}
        </span>
      </div>
      <div className="bg-background rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">USD</span>
          <span className="font-semibold">$25.00</span>
        </div>
        <div className="flex items-center justify-center text-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 10h14l-3-3M17 14H3l3 3" />
          </svg>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted flex items-center gap-1.5">
            Bs
            <span className="text-[10px] px-1.5 py-0.5 bg-accent/10 text-accent rounded font-medium">
              BCV
            </span>
          </span>
          <span className="font-semibold text-muted">{t("home.mockupRateNote")}</span>
        </div>
      </div>
      <button
        type="button"
        tabIndex={-1}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 py-2.5 bg-accent text-white text-sm font-semibold rounded-lg pointer-events-none"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {t("home.mockupApproved")}
      </button>
    </VisualFrame>
  );
}

function ScannerVisual({ t }: { t: (k: string) => string }) {
  return (
    <VisualFrame>
      <div className="relative bg-background rounded-xl p-6 flex items-center justify-center">
        {/* Corner brackets */}
        <span className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-accent rounded-tl" />
        <span className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-accent rounded-tr" />
        <span className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-accent rounded-bl" />
        <span className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-accent rounded-br" />
        <div className="bg-surface rounded-lg p-3 border border-border">
          <QRCodeSVG
            value="https://matickets.net"
            size={120}
            bgColor="transparent"
            fgColor="#1a2b4a"
            level="L"
          />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2.5 bg-success/10 rounded-lg px-4 py-3">
        <span className="w-8 h-8 rounded-full bg-success text-white flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">
            {t("home.mockupApproved")}
          </p>
          <p className="text-[11px] text-muted truncate">
            {t("home.mockupTicketType")} · #A-142
          </p>
        </div>
      </div>
    </VisualFrame>
  );
}
