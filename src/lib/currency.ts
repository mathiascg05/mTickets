// Currency helpers. `concerts.currency` / `concerts.country` are metadata for
// now: they do not change any pricing behaviour, they only decide which symbol
// the UI prints instead of a hardcoded "$".

export const DEFAULT_CURRENCY = "USD";
export const DEFAULT_COUNTRY = "VE";

const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  VES: "Bs",
  COP: "$",
  MXN: "$",
  ARS: "$",
  PEN: "S/",
  CLP: "$",
  BRL: "R$",
};

/** "USD" -> "$". Unknown codes print as the code itself, never as a wrong symbol. */
export function currencySymbol(code?: string | null): string {
  if (!code) return SYMBOLS[DEFAULT_CURRENCY];
  return SYMBOLS[code.toUpperCase()] ?? code.toUpperCase();
}

export function concertCurrency(
  concert?: { currency?: string | null } | null,
): string {
  return concert?.currency || DEFAULT_CURRENCY;
}

export function concertCountry(
  concert?: { country?: string | null } | null,
): string {
  return concert?.country || DEFAULT_COUNTRY;
}

/** Symbol for a concert, with the USD fallback baked in. */
export function concertCurrencySymbol(
  concert?: { currency?: string | null } | null,
): string {
  return currencySymbol(concertCurrency(concert));
}

/** "$12.00" — amounts stay in the event's currency, Bs formatting is separate. */
export function formatMoney(
  amount: number,
  concert?: { currency?: string | null } | null,
): string {
  return `${concertCurrencySymbol(concert)}${amount.toFixed(2)}`;
}
