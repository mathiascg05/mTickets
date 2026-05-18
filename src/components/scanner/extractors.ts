export function extractConcertOrderId(text: string): string | null {
  const urlMatch = text.match(/\/ticket\/([a-zA-Z0-9-]+)/);
  if (urlMatch) return urlMatch[1];
  const uuidMatch = text.match(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
  if (uuidMatch) return uuidMatch[0];
  return null;
}

export function extractGuestOrderId(text: string): string | null {
  const glMatch = text.match(/^gl:([a-f0-9-]{36})$/i);
  if (glMatch) return glMatch[1];
  const urlMatch = text.match(/\/guest-ticket\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  const uuidMatch = text.match(
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  );
  if (uuidMatch) return uuidMatch[0];
  return null;
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
