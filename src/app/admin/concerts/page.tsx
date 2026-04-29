"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { toSlug } from "@/lib/slug";
import { id } from "@instantdb/react";
import Link from "next/link";
import { useEffect, useState } from "react";

function LiveViewerCount({ concertId }: { concertId: string }) {
  const room = db.room("eventPage", concertId);
  const { peers } = db.rooms.usePresence(room, {
    user: false,
  });
  const count = Object.keys(peers).length;
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent-light border border-accent/30">
      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
      {count}
    </span>
  );
}

export default function AdminConcertsPage() {
  const { email, isSuperAdmin } = useAuthContext();
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { isLoading, data } = db.useQuery({
    concerts: {
      $: {
        ...(isSuperAdmin ? {} : { where: { organizerEmail: email } }),
        order: { createdAt: "desc" as const },
      },
      ticketTypes: {},
    },
  });

  // Events the user collaborates on (separate query — see admin/page.tsx).
  const { data: collabData } = db.useQuery(
    isSuperAdmin || !email
      ? null
      : {
          eventCollaborators: {
            $: { where: { email } },
            concert: { ticketTypes: {} },
          },
        },
  );

  // Backfill slugs for existing concerts missing them
  useEffect(() => {
    if (!data?.concerts) return;
    const missing = data.concerts.filter((c) => !c.slug);
    if (missing.length === 0) return;
    const txns = missing.map((c) =>
      db.tx.concerts[c.id].update({ slug: toSlug(c.name) }),
    );
    db.transact(txns);
  }, [data?.concerts]);

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }

  const ownedConcerts = data.concerts;
  const collabConcerts = (collabData?.eventCollaborators ?? [])
    .map((ec) => ec.concert)
    .filter((c): c is NonNullable<typeof c> => c != null);
  const seenIds = new Set<string>();
  const allConcerts = [...ownedConcerts, ...collabConcerts]
    .filter((c) => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/assign-prefix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to assign order number prefix");
      }
      const { prefix } = (await res.json()) as { prefix: string };

      await db.transact(
        db.tx.concerts[id()].update({
          name,
          slug: toSlug(name),
          date,
          venue,
          description,
          status: "draft",
          organizerEmail: email,
          orderNumberPrefix: prefix,
          createdAt: Date.now(),
        }),
      );
      setName("");
      setDate("");
      setVenue("");
      setDescription("");
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create event";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">{t("admin.events")}</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {showForm ? t("common.cancel") : t("admin.newEvent")}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-surface border border-border rounded-xl p-6 mb-6 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">{t("common.name")}</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                placeholder={t("common.name")}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">{t("common.date")}</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">{t("common.venue")} <span className="text-muted font-normal">({t("common.optional")})</span></label>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
              placeholder={t("admin.venuePlaceholder")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              {t("common.description")} <span className="text-muted font-normal">({t("common.optional")})</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors resize-none"
              placeholder={t("admin.descPlaceholder")}
            />
          </div>
          {createError && (
            <p className="text-sm text-red-400">{createError}</p>
          )}
          <button
            type="submit"
            disabled={creating}
            className="px-6 py-2.5 bg-accent hover:bg-accent-dark disabled:bg-accent/40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
          >
            {creating ? t("common.loading") : t("admin.createEvent")}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {allConcerts.length === 0 ? (
          <p className="text-muted text-center py-12">
            {t("admin.noEvents")}
          </p>
        ) : (
          allConcerts.map((concert) => (
            <Link
              key={concert.id}
              href={`/admin/concerts/${concert.id}`}
              className="flex items-center justify-between bg-surface border border-border rounded-xl p-5 hover:border-accent/50 transition-colors group"
            >
              <div>
                <h3 className="font-semibold group-hover:text-accent-light transition-colors">
                  {concert.name}
                </h3>
                <p className="text-sm text-muted">
                  {concert.venue} &middot; {concert.date}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {concert.status === "active" && (
                  <LiveViewerCount concertId={concert.id} />
                )}
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    concert.status === "active"
                      ? "bg-success/10 text-success border-success/30"
                      : "bg-muted/10 text-muted border-muted/30"
                  }`}
                >
                  {concert.status === "active" ? t("common.active") : t("common.draft")}
                </span>
                <span className="text-muted text-sm">
                  {concert.ticketTypes.length} {concert.ticketTypes.length !== 1 ? t("admin.ticketTypes") : t("admin.ticketType")}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
