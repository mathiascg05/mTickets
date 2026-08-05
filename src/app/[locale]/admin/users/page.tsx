"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { dateLocale } from "@/lib/i18n";
import { SUPER_ADMIN_EMAIL } from "@/lib/authHelpers";
import { fullName } from "@/lib/userNames";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type OrganizedEvent = {
  id: string;
  name: string;
  status: string;
  kind: "concert" | "guestList";
  isDemo: boolean;
};

type Collaboration = {
  eventId: string | null;
  eventName: string | null;
  kind: "concert" | "guestList";
  role: string;
  invitedAt: number | null;
  lastAccessedAt: number | null;
};

type UserRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  type: string | null;
  createdAt: number | null;
  hasPassword: boolean;
  acceptedTermsVersion: string | null;
  acceptedTermsAt: number | null;
  acceptedOrganizerTermsVersion: string | null;
  acceptedOrganizerTermsAt: number | null;
  acceptedPrivacyVersion: string | null;
  acceptedPrivacyAt: number | null;
  balance: { balance: number; currency: string; updatedAt: number } | null;
  eventsOrganized: OrganizedEvent[];
  collaborations: Collaboration[];
  ordersAsBuyer: { count: number; lastAt: number | null };
};

type UserKind = "superadmin" | "organizer" | "collaborator" | "inactive";
type SortKey = "name" | "email" | "createdAt" | "balance" | "events";

function userKind(u: UserRow): UserKind {
  if (u.type === "superadmin" || u.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return "superadmin";
  }
  if (u.eventsOrganized.length > 0) return "organizer";
  if (u.collaborations.length > 0) return "collaborator";
  return "inactive";
}

const KIND_TONE: Record<UserKind, string> = {
  superadmin: "bg-accent/10 text-accent-light",
  organizer: "bg-success/10 text-success",
  collaborator: "bg-warning/10 text-warning",
  inactive: "bg-border/60 text-muted",
};

export default function AdminUsersPage() {
  const { isSuperAdmin } = useAuthContext();
  const { t, lang } = useLanguage();
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";

  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "createdAt",
    dir: "desc",
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSuperAdmin || !refreshToken) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`admin/users ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setUsers(json.users ?? []);
      })
      .catch((err) => {
        console.error("[users] load error:", err);
        if (!cancelled) toast.error(t("admin.usersView.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `t` is intentionally excluded: useLanguage() returns a new function
    // identity every render, so including it would re-run this effect on every
    // render and cancel the in-flight fetch, leaving the page stuck loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, refreshToken]);

  const fmtDate = (ts: number | null | undefined) =>
    ts
      ? `${new Date(ts).toLocaleDateString(dateLocale(lang))} ${new Date(
          ts,
        ).toLocaleTimeString(dateLocale(lang), {
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : "—";

  const fmtDay = (ts: number | null | undefined) =>
    ts ? new Date(ts).toLocaleDateString(dateLocale(lang)) : "—";

  const kindLabel = (k: UserKind) =>
    t(
      {
        superadmin: "admin.usersView.typeSuperAdmin",
        organizer: "admin.usersView.typeOrganizer",
        collaborator: "admin.usersView.typeCollaborator",
        inactive: "admin.usersView.typeInactive",
      }[k],
    );

  const roleLabel = (role: string) =>
    role === "box_office"
      ? t("admin.roleBoxOffice")
      : t("admin.roleCoOrganizer");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = users.filter((u) => {
      const kind = userKind(u);
      if (kindFilter && kind !== kindFilter) return false;
      if (stateFilter === "withBalance" && !u.balance) return false;
      if (stateFilter === "withEvents" && u.eventsOrganized.length === 0) {
        return false;
      }
      if (term) {
        const hay =
          `${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email} ${u.phone ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (u: UserRow): string | number => {
      switch (sort.key) {
        case "name":
          return fullName(u).toLowerCase() || u.email.toLowerCase();
        case "email":
          return u.email.toLowerCase();
        case "balance":
          return u.balance?.balance ?? 0;
        case "events":
          return u.eventsOrganized.length;
        default:
          return u.createdAt ?? 0;
      }
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
  }, [users, search, kindFilter, stateFilter, sort]);

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-20 text-muted">
        {t("admin.accessDenied")}
      </div>
    );
  }

  const selectClass =
    "px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30";

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "createdAt" || key === "balance" || key === "events" ? "desc" : "asc" },
    );

  const SortableTh = ({
    sortKey,
    label,
    className = "",
  }: {
    sortKey: SortKey;
    label: string;
    className?: string;
  }) => (
    <th className={`px-4 py-3 font-medium ${className}`}>
      <button
        type="button"
        onClick={() => toggleSort(sortKey)}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        <span className="text-[10px]">
          {sort.key === sortKey ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );

  const DetailRow = ({ label, value }: { label: string; value: string }) => (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">{t("admin.usersView.title")}</h1>
      <p className="text-sm text-muted mb-6">{t("admin.usersView.subtitle")}</p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">{t("admin.usersView.allTypes")}</option>
          <option value="superadmin">
            {t("admin.usersView.typeSuperAdmin")}
          </option>
          <option value="organizer">
            {t("admin.usersView.typeOrganizer")}
          </option>
          <option value="collaborator">
            {t("admin.usersView.typeCollaborator")}
          </option>
          <option value="inactive">{t("admin.usersView.typeInactive")}</option>
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">{t("admin.usersView.allStates")}</option>
          <option value="withBalance">
            {t("admin.usersView.filterWithBalance")}
          </option>
          <option value="withEvents">
            {t("admin.usersView.filterWithEvents")}
          </option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("admin.usersView.search")}
          className={`${selectClass} flex-1 min-w-[180px]`}
        />
      </div>

      {loading ? (
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      ) : visible.length === 0 ? (
        <p className="text-muted text-center py-10">
          {t("admin.usersView.empty")}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted mb-2">
            {t("admin.usersView.count", { count: visible.length })}
          </p>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <SortableTh
                      sortKey="name"
                      label={t("admin.usersView.colUser")}
                    />
                    <th className="px-4 py-3 font-medium">
                      {t("admin.usersView.colPhone")}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {t("admin.usersView.colType")}
                    </th>
                    <SortableTh
                      sortKey="createdAt"
                      label={t("admin.usersView.colRegistered")}
                    />
                    <SortableTh
                      sortKey="balance"
                      label={t("admin.usersView.colBalance")}
                    />
                    <SortableTh
                      sortKey="events"
                      label={t("admin.usersView.colEvents")}
                    />
                    <th className="px-4 py-3 font-medium">
                      {t("admin.usersView.colCollaborations")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => {
                    const kind = userKind(u);
                    const isExpanded = expandedId === u.id;
                    const name = fullName(u);
                    return [
                      <tr
                        key={u.id}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : u.id)
                        }
                        className="border-b border-border/50 last:border-0 hover:bg-background/40 cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">
                            {name || t("admin.usersView.noName")}
                          </p>
                          <p className="text-xs text-muted">{u.email}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {u.phone || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${KIND_TONE[kind]}`}
                          >
                            {kindLabel(kind)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-muted">
                          {fmtDay(u.createdAt)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {u.balance
                            ? `$${u.balance.balance.toFixed(2)}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {u.eventsOrganized.length || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {u.collaborations.length || "—"}
                        </td>
                      </tr>,
                      isExpanded ? (
                        <tr key={`${u.id}-detail`} className="bg-background/40">
                          <td colSpan={7} className="px-4 py-5">
                            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                              <DetailRow
                                label={t("admin.usersView.colUser")}
                                value={name || "—"}
                              />
                              <DetailRow
                                label={t("auth.email")}
                                value={u.email}
                              />
                              <DetailRow
                                label={t("admin.usersView.colPhone")}
                                value={u.phone || "—"}
                              />
                              <DetailRow
                                label={t("admin.usersView.colRegistered")}
                                value={fmtDate(u.createdAt)}
                              />
                              <DetailRow
                                label={t("admin.usersView.password")}
                                value={
                                  u.hasPassword
                                    ? t("admin.usersView.hasPassword")
                                    : t("admin.usersView.noPassword")
                                }
                              />
                              <DetailRow
                                label={t("admin.usersView.legalTerms")}
                                value={
                                  u.acceptedTermsVersion
                                    ? `${u.acceptedTermsVersion} · ${fmtDay(u.acceptedTermsAt)}`
                                    : t("admin.usersView.notAccepted")
                                }
                              />
                              <DetailRow
                                label={t("admin.usersView.legalOrganizerTerms")}
                                value={
                                  u.acceptedOrganizerTermsVersion
                                    ? `${u.acceptedOrganizerTermsVersion} · ${fmtDay(u.acceptedOrganizerTermsAt)}`
                                    : t("admin.usersView.notAccepted")
                                }
                              />
                              <DetailRow
                                label={t("admin.usersView.legalPrivacy")}
                                value={
                                  u.acceptedPrivacyVersion
                                    ? `${u.acceptedPrivacyVersion} · ${fmtDay(u.acceptedPrivacyAt)}`
                                    : t("admin.usersView.notAccepted")
                                }
                              />
                              <DetailRow
                                label={t("admin.currentBalance")}
                                value={
                                  u.balance
                                    ? `$${u.balance.balance.toFixed(2)} ${u.balance.currency} · ${fmtDay(u.balance.updatedAt)}`
                                    : "—"
                                }
                              />
                              <DetailRow
                                label={t("admin.usersView.ordersAsBuyer")}
                                value={
                                  u.ordersAsBuyer.count > 0
                                    ? `${u.ordersAsBuyer.count} · ${fmtDay(u.ordersAsBuyer.lastAt)}`
                                    : "—"
                                }
                              />
                              <DetailRow label="ID" value={u.id} />
                            </div>

                            <div className="grid sm:grid-cols-2 gap-5">
                              <div>
                                <p className="text-xs text-muted mb-2">
                                  {t("admin.usersView.eventsOrganized")}
                                </p>
                                {u.eventsOrganized.length === 0 ? (
                                  <p className="text-sm text-muted">
                                    {t("admin.usersView.noEvents")}
                                  </p>
                                ) : (
                                  <ul className="space-y-1">
                                    {u.eventsOrganized.map((ev) => (
                                      <li key={`${ev.kind}-${ev.id}`}>
                                        <Link
                                          href={
                                            ev.kind === "concert"
                                              ? `/admin/orders/${ev.id}`
                                              : `/admin/orders/guest-list/${ev.id}`
                                          }
                                          onClick={(e) => e.stopPropagation()}
                                          className="text-sm text-accent-light hover:text-accent transition-colors"
                                        >
                                          {ev.name}
                                        </Link>
                                        <span className="text-xs text-muted ml-2">
                                          {ev.status}
                                          {ev.isDemo
                                            ? ` · ${t("admin.demoEvent")}`
                                            : ""}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <p className="text-xs text-muted mb-2">
                                  {t("admin.usersView.collaborations")}
                                </p>
                                {u.collaborations.length === 0 ? (
                                  <p className="text-sm text-muted">
                                    {t("admin.usersView.noCollaborations")}
                                  </p>
                                ) : (
                                  <ul className="space-y-1">
                                    {u.collaborations.map((c, i) => (
                                      <li
                                        key={`${c.kind}-${c.eventId}-${i}`}
                                        className="text-sm"
                                      >
                                        {c.eventName || c.eventId || "—"}
                                        <span className="text-xs text-muted ml-2">
                                          {roleLabel(c.role)}
                                          {c.lastAccessedAt
                                            ? ` · ${t("admin.usersView.lastAccess")}: ${fmtDay(c.lastAccessedAt)}`
                                            : ""}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
