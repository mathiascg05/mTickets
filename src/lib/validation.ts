const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CEDULA_RE = /^[0-9]{1,20}$/;

export function isValidUUID(val: unknown): val is string {
  return typeof val === "string" && UUID_RE.test(val);
}

export function isValidQty(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= 1 && val <= 10;
}

export function isValidEmail(val: unknown): val is string {
  return typeof val === "string" && val.length <= 254 && EMAIL_RE.test(val);
}

export function isValidName(val: unknown): val is string {
  return (
    typeof val === "string" &&
    val.trim().length > 0 &&
    val.length <= 100 &&
    !val.includes("\n") &&
    !val.includes("\r")
  );
}

export function isValidCedula(val: unknown): val is string {
  return typeof val === "string" && CEDULA_RE.test(val.trim());
}

export type ValidationError = { field: string; message: string };

export function validateAttendee(
  attendee: Record<string, unknown>,
  index: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `attendees[${index}]`;

  if (!isValidName(attendee.firstName)) {
    errors.push({ field: `${prefix}.firstName`, message: "Invalid first name (1-100 chars, no newlines)" });
  }
  if (!isValidName(attendee.lastName)) {
    errors.push({ field: `${prefix}.lastName`, message: "Invalid last name (1-100 chars, no newlines)" });
  }
  if (!isValidEmail(attendee.email)) {
    errors.push({ field: `${prefix}.email`, message: "Invalid email address" });
  }
  if (!isValidCedula(attendee.cedula)) {
    errors.push({ field: `${prefix}.cedula`, message: "Invalid cedula (numeric, max 20 digits)" });
  }

  return errors;
}
