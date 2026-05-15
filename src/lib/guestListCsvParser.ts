import { isValidEmail, isValidCedula, isValidName } from "./validation";

export type ParsedEntry = {
  email?: string;
  cedula?: string;
  firstName?: string;
  lastName?: string;
  priceOverride?: number;
  ticketTypeName?: string;
};

export type ParseRowError = { row: number; reason: string };

export type ParseResult = {
  valid: ParsedEntry[];
  invalid: ParseRowError[];
};

const MAX_ROWS = 5000;

const HEADER_ALIASES: Record<string, keyof ParsedEntry> = {
  email: "email",
  "e-mail": "email",
  correo: "email",
  cedula: "cedula",
  "cédula": "cedula",
  ci: "cedula",
  dni: "cedula",
  documento: "cedula",
  firstname: "firstName",
  "first name": "firstName",
  nombre: "firstName",
  nombres: "firstName",
  lastname: "lastName",
  "last name": "lastName",
  apellido: "lastName",
  apellidos: "lastName",
  price: "priceOverride",
  precio: "priceOverride",
  monto: "priceOverride",
  amount: "priceOverride",
  tipo: "ticketTypeName",
  type: "ticketTypeName",
  category: "ticketTypeName",
  categoria: "ticketTypeName",
  ticket: "ticketTypeName",
  "ticket type": "ticketTypeName",
  "tipo de entrada": "ticketTypeName",
};

function normalizeKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function mapHeaders(headers: string[]): (keyof ParsedEntry | null)[] {
  return headers.map((h) => {
    const norm = normalizeKey(h);
    return HEADER_ALIASES[norm] ?? null;
  });
}

export function parseRows(
  rows: Record<string, unknown>[] | string[][],
): ParseResult {
  const valid: ParsedEntry[] = [];
  const invalid: ParseRowError[] = [];

  if (rows.length === 0) return { valid, invalid };
  if (rows.length > MAX_ROWS) {
    return {
      valid: [],
      invalid: [{ row: 0, reason: `Too many rows (max ${MAX_ROWS})` }],
    };
  }

  let headerMap: (keyof ParsedEntry | null)[] = [];
  let isObjectRows = false;
  let objectKeys: string[] = [];

  const first = rows[0];
  if (Array.isArray(first)) {
    headerMap = mapHeaders(first);
  } else if (typeof first === "object" && first !== null) {
    isObjectRows = true;
    objectKeys = Object.keys(first);
    headerMap = mapHeaders(objectKeys);
  } else {
    return {
      valid: [],
      invalid: [{ row: 0, reason: "Unrecognized row format" }],
    };
  }

  if (!headerMap.some((h) => h === "email" || h === "cedula")) {
    return {
      valid: [],
      invalid: [
        {
          row: 0,
          reason: "CSV must include at least an 'email' or 'cedula' column",
        },
      ],
    };
  }

  const startIdx = isObjectRows ? 0 : 1;
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + (isObjectRows ? 1 : 1);
    let cells: unknown[];
    if (Array.isArray(row)) {
      cells = row;
    } else if (typeof row === "object" && row !== null) {
      cells = objectKeys.map((k) => (row as Record<string, unknown>)[k]);
    } else {
      invalid.push({ row: rowNumber, reason: "Invalid row" });
      continue;
    }

    const entry: ParsedEntry = {};
    for (let c = 0; c < headerMap.length; c++) {
      const key = headerMap[c];
      if (!key) continue;
      const raw = cells[c];
      if (raw === undefined || raw === null || raw === "") continue;
      const str = String(raw).trim();
      if (!str) continue;
      if (key === "priceOverride") {
        const num = Number(str.replace(/,/g, "."));
        if (!Number.isFinite(num) || num < 0) {
          invalid.push({ row: rowNumber, reason: `Invalid price "${str}"` });
          entry.priceOverride = undefined;
          continue;
        }
        entry.priceOverride = Math.round(num * 100) / 100;
      } else if (key === "email") {
        const lower = str.toLowerCase();
        entry.email = lower;
      } else if (key === "cedula") {
        entry.cedula = str.replace(/\D/g, "");
      } else if (key === "ticketTypeName") {
        entry.ticketTypeName = str;
      } else {
        entry[key] = str;
      }
    }

    const errors: string[] = [];
    if (!entry.email && !entry.cedula) {
      errors.push("Missing both email and cedula");
    }
    if (entry.email && !isValidEmail(entry.email)) {
      errors.push(`Invalid email "${entry.email}"`);
    }
    if (entry.cedula && !isValidCedula(entry.cedula)) {
      errors.push(`Invalid cedula "${entry.cedula}"`);
    }
    if (entry.firstName && !isValidName(entry.firstName)) {
      errors.push("Invalid first name");
    }
    if (entry.lastName && !isValidName(entry.lastName)) {
      errors.push("Invalid last name");
    }

    if (errors.length > 0) {
      invalid.push({ row: rowNumber, reason: errors.join("; ") });
      continue;
    }

    valid.push(entry);
  }

  return { valid, invalid };
}

export const GUEST_LIST_MAX_ROWS = MAX_ROWS;
