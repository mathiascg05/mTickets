"use client";

import { useLanguage } from "@/lib/LanguageContext";

export type SearchableOrder = {
  id: string;
  firstName?: string;
  lastName?: string;
  cedula?: string;
  orderNumber?: string;
  status?: string;
  visited?: boolean;
  ticketTypeName?: string;
};

export function SearchUI({
  query,
  setQuery,
  handleSubmit,
  results,
  trimmed,
  onSelect,
}: {
  query: string;
  setQuery: (s: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  results: SearchableOrder[];
  trimmed: string;
  onSelect: (orderId: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 px-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors text-sm"
          placeholder={t("scan.searchPlaceholder")}
        />
        <button
          type="submit"
          disabled={!trimmed}
          className="px-4 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors text-sm disabled:opacity-50"
        >
          {t("scan.search")}
        </button>
      </form>

      {trimmed && results.length === 0 && (
        <p className="text-sm text-muted text-center py-2">
          {t("scan.noResults", { query: trimmed })}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onSelect(o.id);
                setQuery("");
              }}
              className="w-full text-left bg-surface border border-border rounded-lg p-3 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {o.firstName} {o.lastName}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {o.cedula}
                    {o.ticketTypeName ? ` · ${o.ticketTypeName}` : ""}
                    {o.orderNumber ? ` · ${o.orderNumber}` : ""}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {o.visited && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-warning/15 text-warning">
                      {t("scan.badgeVisited")}
                    </span>
                  )}
                  {o.status && o.status !== "approved" && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-danger/15 text-danger uppercase">
                      {o.status}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
