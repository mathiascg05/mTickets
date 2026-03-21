export const SUPER_ADMIN_EMAIL = "matickets.ve@gmail.com";

export function isSuperAdmin(email: string | undefined | null): boolean {
  return email?.toLowerCase() === SUPER_ADMIN_EMAIL;
}

export function isAuthorizedForConcert(
  userEmail: string,
  concertOrganizerEmail: string,
): boolean {
  return (
    userEmail.toLowerCase() === SUPER_ADMIN_EMAIL ||
    userEmail.toLowerCase() === concertOrganizerEmail.toLowerCase()
  );
}
