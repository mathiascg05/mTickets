"use client";

import { useLanguage } from "@/lib/LanguageContext";
import type { CollaboratorRole } from "@/lib/authHelpers";

export type CollaboratorRoleValue = CollaboratorRole;

export const COLLABORATOR_ROLE_OPTIONS: CollaboratorRoleValue[] = [
  "co_organizer",
  "box_office",
];

export function roleLabelKey(role: string | undefined | null): string {
  return role === "box_office"
    ? "admin.roleBoxOffice"
    : "admin.roleCoOrganizer";
}

export function roleDescKey(role: CollaboratorRoleValue): string {
  return role === "box_office"
    ? "admin.roleBoxOfficeDesc"
    : "admin.roleCoOrganizerDesc";
}

/** Small colored pill showing a collaborator's role. */
export function RoleBadge({ role }: { role?: string | null }) {
  const { t } = useLanguage();
  const isBox = role === "box_office";
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
        isBox ? "bg-accent/10 text-accent-light" : "bg-blue-500/10 text-blue-600"
      }`}
    >
      {t(roleLabelKey(role))}
    </span>
  );
}

/** Role picker used when inviting or changing a collaborator's role. */
export function RoleSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: CollaboratorRoleValue;
  onChange: (role: CollaboratorRoleValue) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as CollaboratorRoleValue)}
      className={
        className ??
        "px-3 py-2.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light transition-colors disabled:opacity-50"
      }
    >
      {COLLABORATOR_ROLE_OPTIONS.map((r) => (
        <option key={r} value={r}>
          {t(roleLabelKey(r))}
        </option>
      ))}
    </select>
  );
}
