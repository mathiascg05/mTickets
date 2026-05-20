export const VENEZUELAN_BANKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "0102", name: "Banco de Venezuela" },
  { code: "0104", name: "Venezolano de Crédito" },
  { code: "0105", name: "Mercantil" },
  { code: "0108", name: "Banco Provincial" },
  { code: "0114", name: "Bancaribe" },
  { code: "0115", name: "Banco Exterior" },
  { code: "0128", name: "Banco Caroní" },
  { code: "0134", name: "Banesco" },
  { code: "0137", name: "Banco Sofitasa" },
  { code: "0138", name: "Banco Plaza" },
  { code: "0146", name: "Bangente" },
  { code: "0151", name: "BFC Banco Fondo Común" },
  { code: "0156", name: "100% Banco" },
  { code: "0157", name: "DelSur" },
  { code: "0163", name: "Banco del Tesoro" },
  { code: "0166", name: "Banco Agrícola" },
  { code: "0168", name: "Bancrecer" },
  { code: "0169", name: "Mi Banco" },
  { code: "0171", name: "Banco Activo" },
  { code: "0172", name: "Bancamiga" },
  { code: "0174", name: "Banplus" },
  { code: "0175", name: "Bicentenario" },
  { code: "0177", name: "Banfanb" },
  { code: "0178", name: "N58 Banco Digital" },
  { code: "0191", name: "BNC Banco Nacional de Crédito" },
];

export const CEDULA_PREFIXES = ["V", "E", "J", "P"] as const;
export const PHONE_PREFIXES = ["0412", "0414", "0416", "0424", "0426"] as const;

export type CedulaPrefix = (typeof CEDULA_PREFIXES)[number];
export type PhonePrefix = (typeof PHONE_PREFIXES)[number];

export type CedulaParts = { prefix: CedulaPrefix; digits: string };
export type PhoneParts = { prefix: PhonePrefix; rest: string };
export type BankParts = { code: string | null; name: string };

export function parseCedula(value: string | null | undefined): CedulaParts {
  const raw = (value ?? "").trim();
  if (!raw) return { prefix: "V", digits: "" };
  const match = raw.match(/^([VEJPvejp])[\s-]?(\d+)$/);
  if (match) {
    return { prefix: match[1].toUpperCase() as CedulaPrefix, digits: match[2] };
  }
  const digits = raw.replace(/\D/g, "");
  return { prefix: "V", digits };
}

export function formatCedula(parts: CedulaParts): string {
  const digits = parts.digits.trim();
  if (!digits) return "";
  return `${parts.prefix}-${digits}`;
}

export function parsePhone(value: string | null | undefined): PhoneParts {
  const raw = (value ?? "").replace(/\D/g, "");
  if (!raw) return { prefix: "0412", rest: "" };
  const matched = PHONE_PREFIXES.find((p) => raw.startsWith(p));
  if (matched) {
    return { prefix: matched, rest: raw.slice(matched.length) };
  }
  return { prefix: "0412", rest: raw.slice(-7) };
}

export function formatPhone(parts: PhoneParts): string {
  const rest = parts.rest.replace(/\D/g, "");
  if (!rest) return "";
  return `${parts.prefix}-${rest}`;
}

export function parseBank(value: string | null | undefined): BankParts {
  const raw = (value ?? "").trim();
  if (!raw) return { code: null, name: "" };
  const withCode = raw.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (withCode) {
    return { code: withCode[2], name: withCode[1].trim() };
  }
  const lower = raw.toLowerCase();
  const known = VENEZUELAN_BANKS.find((b) => b.name.toLowerCase() === lower);
  if (known) {
    return { code: known.code, name: known.name };
  }
  return { code: null, name: raw };
}

export function formatBank(parts: BankParts): string {
  const name = parts.name.trim();
  if (!name) return "";
  if (parts.code) return `${name} (${parts.code})`;
  return name;
}
