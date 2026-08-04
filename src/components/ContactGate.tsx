"use client";

import { useLanguage } from "@/lib/LanguageContext";
import { ContactForm, type ContactValues } from "@/components/ContactForm";

/**
 * Blocking gate shown after login when the account is missing the contact
 * details we ask for at registration (firstName / lastName / phone). Accounts
 * created before those fields existed land here; the only way out without
 * filling them in is signing out. Mirrors LegalGate.
 */
export function ContactGate({
  initial,
  refreshToken,
  onSignOut,
}: {
  /** Whatever the account already has, so partial records aren't retyped. */
  initial?: ContactValues;
  refreshToken: string;
  onSignOut: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-xl font-bold">
            {t("admin.completeContactTitle")}
          </h2>
          <p className="text-sm text-muted mt-1">
            {t("admin.completeContactIntro")}
          </p>
        </div>
        <ContactForm
          initial={initial}
          refreshToken={refreshToken}
          // On success the layout's $users query is reactive: it re-renders and
          // drops the gate on its own.
          footerLeft={
            <button
              type="button"
              onClick={onSignOut}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              {t("legalGate.signOut")}
            </button>
          }
        />
      </div>
    </div>
  );
}
