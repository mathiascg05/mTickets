export const SUPER_ADMIN_EMAIL = "matickets.ve@gmail.com";

export function isSuperAdmin(email: string | undefined | null): boolean {
  return email?.toLowerCase() === SUPER_ADMIN_EMAIL;
}

export type ConcertAuthInfo = {
  organizerEmail: string;
  collaborators?: { email: string }[] | null;
};

export function isAuthorizedForConcert(
  userEmail: string,
  concert: string | ConcertAuthInfo,
): boolean {
  const lower = userEmail.toLowerCase();
  if (lower === SUPER_ADMIN_EMAIL) return true;

  if (typeof concert === "string") {
    return lower === concert.toLowerCase();
  }

  if (lower === concert.organizerEmail.toLowerCase()) return true;
  return (concert.collaborators ?? []).some(
    (c) => c.email.toLowerCase() === lower,
  );
}

export function isPrimaryOrganizer(
  userEmail: string,
  concertOrganizerEmail: string,
): boolean {
  const lower = userEmail.toLowerCase();
  return (
    lower === SUPER_ADMIN_EMAIL ||
    lower === concertOrganizerEmail.toLowerCase()
  );
}
