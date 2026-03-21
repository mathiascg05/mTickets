"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { toSlug } from "@/lib/slug";
import { id } from "@instantdb/react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminConcertsPage() {
  const { email, isSuperAdmin } = useAuthContext();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");

  const { isLoading, data } = db.useQuery({
    concerts: {
      $: {
        ...(isSuperAdmin ? {} : { where: { organizerEmail: email } }),
        order: { createdAt: "desc" as const },
      },
      ticketTypes: {},
    },
  });

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
    return <div className="animate-pulse text-muted">Loading...</div>;
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    db.transact(
      db.tx.concerts[id()].update({
        name,
        slug: toSlug(name),
        date,
        venue,
        description,
        status: "draft",
        organizerEmail: email,
        createdAt: Date.now(),
      }),
    );
    setName("");
    setDate("");
    setVenue("");
    setDescription("");
    setShowForm(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Events</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {showForm ? "Cancel" : "+ New Event"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-surface border border-border rounded-xl p-6 mb-6 space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
                placeholder="Event name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Date</label>
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
            <label className="block text-sm font-medium mb-1.5">Venue <span className="text-muted font-normal">(optional)</span></label>
            <input
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
              placeholder="Venue name and address"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Description <span className="text-muted font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors resize-none"
              placeholder="Event description"
            />
          </div>
          <button
            type="submit"
            className="px-6 py-2.5 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
          >
            Create Event
          </button>
        </form>
      )}

      <div className="space-y-3">
        {data.concerts.length === 0 ? (
          <p className="text-muted text-center py-12">
            No events yet. Create your first one!
          </p>
        ) : (
          data.concerts.map((concert) => (
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
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    concert.status === "active"
                      ? "bg-success/10 text-success border-success/30"
                      : "bg-muted/10 text-muted border-muted/30"
                  }`}
                >
                  {concert.status}
                </span>
                <span className="text-muted text-sm">
                  {concert.ticketTypes.length} ticket type
                  {concert.ticketTypes.length !== 1 ? "s" : ""}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
