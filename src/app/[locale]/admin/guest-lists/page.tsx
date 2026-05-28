"use client";

import { db } from "@/lib/db";
import { useAuthContext } from "@/lib/AuthContext";
import { useLanguage } from "@/lib/LanguageContext";
import { toSlug } from "@/lib/slug";
import { hasContactInfo } from "@/lib/organizerProfile";
import { isValidName, isValidPhone } from "@/lib/validation";
import PhoneField from "@/components/PhoneField";
import { id } from "@instantdb/react";
import Link from "next/link";
import { useState } from "react";

export default function AdminGuestListsPage() {
  const { email, isSuperAdmin } = useAuthContext();
  const { user } = db.useAuth();
  const refreshToken = user?.refresh_token || "";
  const { t } = useLanguage();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("0");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showContactForm, setShowContactForm] = useState(false);
  const [cFirstName, setCFirstName] = useState("");
  const [cLastName, setCLastName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  const { data: meData } = db.useQuery(
    email ? { $users: { $: { where: { email } } } } : null,
  );
  const profileComplete = isSuperAdmin || hasContactInfo(meData?.$users?.[0]);

  const { isLoading, data } = db.useQuery({
    guestListEvents: {
      $: {
        ...(isSuperAdmin ? {} : { where: { organizerEmail: email } }),
        order: { createdAt: "desc" as const },
      },
      entries: {},
    },
  });

  if (isLoading || !data) {
    return <div className="animate-pulse text-muted">{t("common.loading")}</div>;
  }

  function handleNewEventClick() {
    if (showForm) {
      setShowForm(false);
      return;
    }
    if (!profileComplete) {
      setContactError(null);
      setShowContactForm(true);
      return;
    }
    setShowForm(true);
  }

  async function handleSaveContact(e: React.FormEvent) {
    e.preventDefault();
    setContactError(null);
    if (!isValidName(cFirstName) || !isValidName(cLastName)) {
      setContactError(t("auth.nameRequired"));
      return;
    }
    if (!isValidPhone(cPhone)) {
      setContactError(t("auth.phoneRequired"));
      return;
    }
    setSavingContact(true);
    try {
      const res = await fetch("/api/organizer-contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${refreshToken}`,
        },
        body: JSON.stringify({
          firstName: cFirstName.trim(),
          lastName: cLastName.trim(),
          phone: cPhone.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setContactError(body.error || t("admin.completeContactError"));
      } else {
        setShowContactForm(false);
        setShowForm(true);
      }
    } catch {
      setContactError(t("admin.completeContactError"));
    } finally {
      setSavingContact(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    if (!profileComplete) {
      setShowForm(false);
      setShowContactForm(true);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const price = Number(defaultPrice);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(t("guestList.invalidPrice"));
      }
      await db.transact(
        db.tx.guestListEvents[id()].update({
          name,
          slug: toSlug(name) + "-" + Math.random().toString(36).slice(2, 6),
          date,
          venue,
          description,
          status: "draft",
          organizerEmail: email,
          defaultPrice: price,
          createdAt: Date.now(),
        }),
      );
      setName("");
      setDate("");
      setVenue("");
      setDescription("");
      setDefaultPrice("0");
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create event";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }

  const events = data.guestListEvents;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">{t("guestList.title")}</h1>
        <button
          onClick={handleNewEventClick}
          className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
        >
          {showForm ? t("common.cancel") : t("guestList.newEvent")}
        </button>
      </div>

      {showContactForm && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveContact}
            className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
          >
            <div>
              <h2 className="text-xl font-bold">{t("admin.completeContactTitle")}</h2>
              <p className="text-sm text-muted mt-1">{t("admin.completeContactIntro")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("auth.firstName")}</label>
                <input
                  type="text"
                  required
                  value={cFirstName}
                  onChange={(e) => setCFirstName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                  placeholder={t("auth.firstNamePlaceholder")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">{t("auth.lastName")}</label>
                <input
                  type="text"
                  required
                  value={cLastName}
                  onChange={(e) => setCLastName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light focus:ring-1 focus:ring-accent-light/30 transition-colors"
                  placeholder={t("auth.lastNamePlaceholder")}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">{t("auth.phoneLabel")}</label>
              <PhoneField value={cPhone} onChange={setCPhone} />
            </div>
            {contactError && <p className="text-danger text-sm">{contactError}</p>}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowContactForm(false)}
                className="text-sm text-muted hover:text-foreground transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={savingContact}
                className="px-5 py-2.5 bg-accent hover:bg-accent-dark disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
              >
                {savingContact ? t("admin.completeContactSaving") : t("admin.completeContactSave")}
              </button>
            </div>
          </form>
        </div>
      )}

      <p className="text-sm text-muted mb-6 max-w-2xl">{t("guestList.intro")}</p>

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
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("common.venue")} <span className="text-muted font-normal">({t("common.optional")})</span>
              </label>
              <input
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">
                {t("guestList.defaultPrice")} (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(e.target.value)}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg focus:outline-none focus:border-accent-light transition-colors"
              />
              <p className="text-xs text-muted mt-1">{t("guestList.defaultPriceHint")}</p>
            </div>
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
            />
          </div>
          {createError && <p className="text-sm text-red-400">{createError}</p>}
          <button
            type="submit"
            disabled={creating}
            className="px-6 py-2.5 bg-accent hover:bg-accent-dark disabled:bg-accent/40 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-lg shadow-accent/20"
          >
            {creating ? t("common.loading") : t("guestList.createEvent")}
          </button>
        </form>
      )}

      <div className="space-y-3">
        {events.length === 0 ? (
          <p className="text-muted text-center py-12">{t("guestList.noEvents")}</p>
        ) : (
          events.map((ev) => {
            const total = ev.entries?.length || 0;
            return (
              <Link
                key={ev.id}
                href={`/admin/guest-lists/${ev.id}`}
                className="flex items-center justify-between bg-surface border border-border rounded-xl p-5 hover:border-accent/50 transition-colors group"
              >
                <div>
                  <h3 className="font-semibold group-hover:text-accent-light transition-colors">{ev.name}</h3>
                  <p className="text-sm text-muted">
                    {ev.venue ? `${ev.venue} · ` : ""}
                    {ev.date}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                      ev.status === "active"
                        ? "bg-success/10 text-success border-success/30"
                        : ev.status === "finalized"
                          ? "bg-blue-100 text-blue-800 border-blue-300"
                          : "bg-muted/10 text-muted border-muted/30"
                    }`}
                  >
                    {ev.status === "active"
                      ? t("common.active")
                      : ev.status === "finalized"
                        ? t("common.finalized")
                        : t("common.draft")}
                  </span>
                  <span className="text-muted text-sm">
                    {total} {total === 1 ? t("guestList.guest") : t("guestList.guests")}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
