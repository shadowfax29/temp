import crypto from 'crypto';
import { AppError } from './AppError';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', LOWER = 'abcdefghijkmnopqrstuvwxyz', DIGIT = '23456789', SYMBOL = '!@#$%&*?';
const pick = (set: string) => set[crypto.randomInt(0, set.length)]!;

/** A random 12-character temporary password with a capital, a small letter, a digit and a symbol (no look-alike characters) */
export function generateTempPassword(): string {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL), ...Array.from({ length: 8 }, () => pick(UPPER + LOWER + DIGIT))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join('');
}

/** The rules for a password a person chooses */
export function checkNewPassword(pw: string, email?: string) {
  if (pw.length < 8) throw AppError.badRequest('Use at least 8 characters.');
  if (pw.length > 100) throw AppError.badRequest('That password is too long.');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw AppError.badRequest('Use letters and at least one number.');
  if (email && pw.toLowerCase().includes(email.split('@')[0]!.toLowerCase()) && email.split('@')[0]!.length >= 4) throw AppError.badRequest('Do not use your email name in the password.');
}
