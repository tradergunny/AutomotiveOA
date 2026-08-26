/**
 * Identity-key normalization (M2 brief: phone and plate are per-Shop unique).
 * Customers store and match phones as bare digits; Vehicles store and match
 * plates with spacing stripped. Normalize on EVERY write and lookup so the
 * unique constraints and phone/plate search behave deterministically.
 */

/**
 * Phone → digits only, +66 country code folded to the domestic leading 0
 * ("+66 81 234 5678" → "0812345678", "081-234-5678" → "0812345678").
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("66") && digits.length > 9) {
    return "0" + digits.slice(2);
  }
  return digits;
}

/** Thai numbers: 9 digits (landline) or 10 digits (mobile), leading 0. */
export function isValidPhone(normalized: string): boolean {
  return /^0\d{8,9}$/.test(normalized);
}

/** Display form: 10 digits → 081-234-5678, 9 digits → 02-123-4567. */
export function formatPhone(normalized: string): string {
  if (/^0\d{9}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }
  if (/^0\d{8}$/.test(normalized)) {
    return `${normalized.slice(0, 2)}-${normalized.slice(2, 5)}-${normalized.slice(5)}`;
  }
  return normalized;
}

/**
 * Plate → spaces/dashes/dots stripped, Latin uppercased ("กข 1234" → "กข1234",
 * "1kd-5678" → "1KD5678"). Thai characters are unaffected by case mapping.
 */
export function normalizePlate(input: string): string {
  return input.replace(/[\s\-.]+/g, "").toUpperCase();
}
