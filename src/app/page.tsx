"use client";

import Link from "next/link";
import { useLanguage, LanguageToggle } from "@/lib/LanguageContext";

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Hero header */}
      <header className="bg-accent text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <span className="text-2xl font-bold tracking-wide">
            ma<span className="text-white/60">Tickets</span>
          </span>
          <LanguageToggle className="border-white/30 text-white/70 hover:text-white" />
        </div>
      </header>

      {/* Hero section */}
      <div className="bg-gradient-to-br from-accent via-accent-dark to-accent-light text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24 sm:py-32 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 tracking-tight">
            {t("home.hero")}
          </h1>
          <p className="text-lg sm:text-xl text-white/70 max-w-2xl mx-auto mb-10">
            {t("home.heroSub")}
          </p>
          <Link
            href="/admin"
            className="inline-block px-8 py-3.5 bg-white text-accent font-semibold rounded-lg hover:bg-white/90 transition-colors shadow-lg"
          >
            {t("home.organizerLogin")}
          </Link>
        </div>
      </div>

      {/* Features section */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">
            {t("home.howItWorks")}
          </h2>
          <p className="text-muted text-center mb-12 max-w-xl mx-auto">
            {t("home.howItWorksSub")}
          </p>

          <div className="grid sm:grid-cols-3 gap-8">
            <div className="bg-surface border border-border rounded-xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-accent font-bold">1</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">{t("home.step1Title")}</h3>
              <p className="text-muted text-sm">{t("home.step1Desc")}</p>
            </div>

            <div className="bg-surface border border-border rounded-xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-accent font-bold">2</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">{t("home.step2Title")}</h3>
              <p className="text-muted text-sm">{t("home.step2Desc")}</p>
            </div>

            <div className="bg-surface border border-border rounded-xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-14 h-14 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-accent font-bold">3</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">{t("home.step3Title")}</h3>
              <p className="text-muted text-sm">{t("home.step3Desc")}</p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-accent text-white/60 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-sm space-y-3">
          <p className="font-semibold text-white">ma<span className="text-white/60">Tickets</span></p>
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
            <Link href="/terminos-organizador" className="hover:text-white transition-colors">
              Términos del Organizador
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
