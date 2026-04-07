"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { t as translate, type Lang } from "./i18n";

type LanguageContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextType>({
  lang: "es",
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children, initialLang }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (initialLang) return initialLang;
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("matickets-lang") as Lang | null;
      if (stored === "es" || stored === "en") return stored;
    }
    return "es";
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    if (typeof window !== "undefined") {
      localStorage.setItem("matickets-lang", newLang);
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(key, lang, params),
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  return (
    <button
      onClick={() => setLang(lang === "es" ? "en" : "es")}
      className={`px-2 py-1 rounded-md text-xs font-semibold border transition-colors ${className || "border-border text-muted hover:text-foreground"}`}
      title={lang === "es" ? "Switch to English" : "Cambiar a Español"}
    >
      {lang === "es" ? "EN" : "ES"}
    </button>
  );
}
