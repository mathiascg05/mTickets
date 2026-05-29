"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { dateLocale } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type AuditRow = {
  id: string;
  action: string;
  actorEmail: string;
  entityType: string;
  entityId: string;
  concertId: string | null;
  guestListEventId: string | null;
  summary: string;
  createdAt: number;
  metadata: Record<string, unknown> | null;
};

// Color family per action prefix, mirroring the balances page badge palette.
function actionTone(action: string): string {
  if (action.endsWith(".approve") || action.endsWith(".bulk_approve") ||
      action === "reconcile.confirm" || action === "balance.deposit" ||
      action === "glentry.create" || action === "glinvites.sent") {
    return "bg-success/10 text-success";
  }
  if (action.endsWith(".reject") || action.endsWith(".cancel") ||
      action === "balance.void" || action === "glentry.delete") {
    return "bg-danger/10 text-danger";
  }
  return "bg-warning/10 text-warning";
}

export default function AuditPage() {
  const { isSuperAdmin } = useAuthContext();
  const { t, lang } = useLanguage();
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";

  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventKey, setEventKey] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [search, setSearch] = useState("");

  // Event names for display + the event filter dropdown (super admin sees all).
  const { data: eventsData } = db.useQuery({
    concerts: {},
    guestListEvents: {},
  });

  const eventNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of eventsData?.concerts ?? []) m.set(c.id, c.name);
    for (const e of eventsData?.guestListEvents ?? []) m.set(e.id, e.name);
    return m;
  }, [eventsData]);

  useEffect(() => {
    if (!isSuperAdmin || !refreshToken) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/audit-log", {
      headers: { Authorization: `Bearer ${refreshToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`audit-log ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setLogs(json.logs ?? []);
      })
      .catch((err) => {
        console.error("[audit] load error:", err);
        if (!cancelled) toast.error(t("admin.auditView.loadError"));
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

  const eventOf = (r: AuditRow) => r.concertId || r.guestListEventId || "";

  const uniqueActions = useMemo(
    () => [...new Set(logs.map((l) => l.action))].sort(),
    [logs],
  );
  const uniqueUsers = useMemo(
    () => [...new Set(logs.map((l) => l.actorEmail))].sort(),
    [logs],
  );
  const eventsInLogs = useMemo(() => {
    const ids = [...new Set(logs.map(eventOf).filter(Boolean))];
    return ids
      .map((id) => ({ id, name: eventNameById.get(id) || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [logs, eventNameById]);

  const filtered = logs.filter((l) => {
    if (eventKey && eventOf(l) !== eventKey) return false;
    if (actionFilter && l.action !== actionFilter) return false;
    if (userFilter && l.actorEmail !== userFilter) return false;
    if (search) {
      const hay = `${l.summary} ${l.actorEmail} ${JSON.stringify(
        l.metadata ?? {},
      )}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const actionLabel = (action: string) => {
    // Action names contain dots (e.g. "order.reject"); next-intl treats dots as
    // nesting separators, so the message keys use "_" instead. Sanitize before lookup.
    const key = `admin.auditView.actions.${action.replace(/\./g, "_")}`;
    const label = t(key);
    return label === key ? action : label;
  };

  if (!isSuperAdmin) {
    return (
      <div className="text-center py-20 text-muted">
        {t("admin.accessDenied")}
      </div>
    );
  }

  const selectClass =
    "px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30";

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">{t("admin.auditView.title")}</h1>
      <p className="text-sm text-muted mb-6">{t("admin.auditView.subtitle")}</p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <select
          value={eventKey}
          onChange={(e) => setEventKey(e.target.value)}
          className={selectClass}
        >
          <option value="">{t("admin.auditView.allEvents")}</option>
          {eventsInLogs.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.name}
            </option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">{t("admin.auditView.allActions")}</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className={selectClass}
        >
          <option value="">{t("admin.auditView.allUsers")}</option>
          {uniqueUsers.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("admin.auditView.search")}
          className={`${selectClass} flex-1 min-w-[180px]`}
        />
      </div>

      {loading ? (
        <div className="animate-pulse text-muted">{t("common.loading")}</div>
      ) : filtered.length === 0 ? (
        <p className="text-muted text-center py-10">
          {t("admin.auditView.empty")}
        </p>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    {t("admin.auditView.colDate")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("admin.auditView.colEvent")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("admin.auditView.colUser")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("admin.auditView.colAction")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("admin.auditView.colDetail")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const evId = eventOf(l);
                  return (
                    <tr
                      key={l.id}
                      className="border-b border-border/50 last:border-0 hover:bg-background/40"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-muted">
                        {new Date(l.createdAt).toLocaleDateString(
                          dateLocale(lang),
                        )}{" "}
                        {new Date(l.createdAt).toLocaleTimeString(
                          dateLocale(lang),
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {evId ? eventNameById.get(evId) || evId : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {l.actorEmail}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionTone(
                            l.action,
                          )}`}
                        >
                          {actionLabel(l.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">{l.summary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
