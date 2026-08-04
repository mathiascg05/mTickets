"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";

type Target = { concertId: string } | { guestListEventId: string };

/**
 * Resolves display names (First Last) for an event's team members by email.
 * The client cannot read other people's $users rows, so this goes through
 * /api/team-names with the caller's auth token.
 *
 * Returns {} while loading or on failure — callers fall back to the email.
 * Refetches when the set of emails changes (e.g. after inviting someone).
 */
export function useTeamNames(
  target: Target,
  emails: string[],
): Record<string, string> {
  const { user } = db.useAuth();
  const token = user?.refresh_token;
  const [names, setNames] = useState<Record<string, string>>({});

  const eventId =
    "concertId" in target ? target.concertId : target.guestListEventId;
  const key = emails
    .map((e) => e.toLowerCase())
    .sort()
    .join(",");

  useEffect(() => {
    if (!token || !eventId || !key) return;
    let cancelled = false;
    fetch("/api/team-names", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(
        "concertId" in target
          ? { concertId: target.concertId }
          : { guestListEventId: target.guestListEventId },
      ),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.names) setNames(data.names);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, eventId, key]);

  return names;
}
