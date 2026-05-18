export function safeStorageGet(key: string): string | null {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

export function safeStorageSet(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // ignore — quota exceeded, blocked storage, etc.
  }
}

export function safeStorageRemove(key: string): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function decodeTokenExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const b64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (typeof payload.exp === "number") return payload.exp;
  } catch {}
  return null;
}

export function tokenIsValid(token: string | null): boolean {
  if (!token) return false;
  const exp = decodeTokenExp(token);
  return !!exp && exp >= Date.now();
}

export type EventKind = "concert" | "guestList";

export function scannerTokenKey(kind: EventKind, eventId: string): string {
  return kind === "concert"
    ? `concertScannerToken:${eventId}`
    : `glScannerToken:${eventId}`;
}

export function scannerEventKey(kind: EventKind, eventId: string): string {
  return kind === "concert"
    ? `concertScannerEvent:${eventId}`
    : `glScannerEvent:${eventId}`;
}
