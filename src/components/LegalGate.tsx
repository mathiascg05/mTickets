"use client";

import Link from "next/link";
import { useState } from "react";
import {
  TERMS_VERSION,
  ORGANIZER_TERMS_VERSION,
  PRIVACY_VERSION,
} from "@/lib/legalVersions";

type OrganizerUser = {
  acceptedTermsVersion?: string;
  acceptedOrganizerTermsVersion?: string;
  acceptedPrivacyVersion?: string;
};

export function hasAcceptedCurrentLegalTerms(user: OrganizerUser | null | undefined): boolean {
  if (!user) return false;
  return (
    user.acceptedTermsVersion === TERMS_VERSION &&
    user.acceptedOrganizerTermsVersion === ORGANIZER_TERMS_VERSION &&
    user.acceptedPrivacyVersion === PRIVACY_VERSION
  );
}

export function LegalGate({
  refreshToken,
  onAccepted,
  onSignOut,
}: {
  refreshToken: string;
  onAccepted: () => void;
  onSignOut: () => void;
}) {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedOrganizerTerms, setAcceptedOrganizerTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = acceptedTerms && acceptedOrganizerTerms && acceptedPrivacy;

  async function handleAccept() {
    if (!allChecked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/accept-legal-terms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "No se pudo guardar la aceptación. Intentá de nuevo.");
      } else {
        onAccepted();
      }
    } catch {
      setError("No se pudo guardar la aceptación. Intentá de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-xl font-bold">Actualización de términos legales</h2>
          <p className="text-sm text-muted mt-1">
            Hemos actualizado nuestros documentos legales. Para continuar usando
            maTickets como organizador necesitamos tu aceptación expresa.
          </p>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4 text-sm text-foreground/80 leading-relaxed">
          <p>
            Por favor revisá los 3 documentos (se abren en una nueva pestaña) y
            marcá cada casilla para confirmar tu aceptación:
          </p>

          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-1 accent-accent-light"
              />
              <span>
                He leído y acepto los{" "}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-light hover:text-accent underline"
                >
                  Términos y Condiciones
                </Link>{" "}
                (versión {TERMS_VERSION}).
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedOrganizerTerms}
                onChange={(e) => setAcceptedOrganizerTerms(e.target.checked)}
                className="mt-1 accent-accent-light"
              />
              <span>
                He leído y acepto los{" "}
                <Link
                  href="/terminos-organizador"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-light hover:text-accent underline"
                >
                  Términos del Organizador
                </Link>{" "}
                (versión {ORGANIZER_TERMS_VERSION}), incluidas las obligaciones de
                pago de comisión y cumplimiento SENIAT.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedPrivacy}
                onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                className="mt-1 accent-accent-light"
              />
              <span>
                He leído y acepto la{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-light hover:text-accent underline"
                >
                  Política de Privacidad
                </Link>{" "}
                (versión {PRIVACY_VERSION}).
              </span>
            </label>
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSignOut}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Cerrar sesión
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!allChecked || submitting}
            className="px-5 py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            {submitting ? "Guardando..." : "Aceptar y continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
