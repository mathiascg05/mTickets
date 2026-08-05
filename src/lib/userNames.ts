/**
 * Display names for platform users ($users.firstName / lastName).
 *
 * Note: the client can only read its own $users row (see instant.perms.ts), so
 * names of *other* people must be resolved server-side. See
 * /api/team-names + useTeamNames for the team-card path.
 */

export function fullName(
  u?: { firstName?: string | null; lastName?: string | null } | null,
): string {
  return [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
}

/** The name when we know it, the email otherwise. Never returns an empty string. */
export function nameOrEmail(
  name: string | undefined | null,
  email: string,
): string {
  return name?.trim() || email;
}
