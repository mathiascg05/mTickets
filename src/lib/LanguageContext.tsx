"use client";

import { type ReactNode } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { useTransition } from "react";
import type { Lang } from "./i18n";

// Compat layer over next-intl. The real provider (NextIntlClientProvider)
// lives in src/app/[locale]/layout.tsx; this component now passes through
// so the ~60 places already importing LanguageProvider keep working.
export function LanguageProvider({
  children,
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  return <>{children}</>;
}

export function useLanguage() {
  const t = useTranslations();
  const locale = useLocale() as Lang;
  const router = useRouter();
  const pathname = usePathname();

  function setLang(newLang: Lang) {
    if (newLang === locale) return;
    router.replace(pathname, { locale: newLang });
  }

  // Adapt next-intl's `t(key, values?)` to match the existing
  // `t(key, params?: Record<string, string | number>)` signature.
  function tt(key: string, params?: Record<string, string | number>): string {
    try {
      return t(key as Parameters<typeof t>[0], params);
    } catch {
      return key;
    }
  }

  return { lang: locale, setLang, t: tt };
}

export function LanguageToggle({ className }: { className?: string }) {
  const locale = useLocale() as Lang;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next: Lang = locale === "es" ? "en" : "es";
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={`px-2 py-1 rounded-md text-xs font-semibold border transition-colors disabled:opacity-50 ${className || "border-border text-muted hover:text-foreground"}`}
      title={locale === "es" ? "Switch to English" : "Cambiar a Español"}
    >
      {locale === "es" ? "EN" : "ES"}
    </button>
  );
}
