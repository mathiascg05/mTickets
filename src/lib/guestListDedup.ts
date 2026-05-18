export function personKey(
  email: string | undefined,
  firstName: string | undefined,
  lastName: string | undefined,
): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const fn = (firstName ?? "").trim().toLowerCase();
  const ln = (lastName ?? "").trim().toLowerCase();
  return `${e}|${fn}|${ln}`;
}
