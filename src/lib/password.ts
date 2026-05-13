import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type PasswordValidationError = {
  code: string;
  values?: Record<string, string | number>;
};

export function validatePassword(password: string): PasswordValidationError | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { code: "PASSWORD_TOO_SHORT", values: { min: MIN_PASSWORD_LENGTH } };
  }
  return null;
}
