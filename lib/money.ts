/**
 * Money (M4 brief, founder ruling): integer satang (THB minor units) in Int
 * columns — exact arithmetic, no float ever, serializes cleanly across the
 * RSC boundary. THB is implicit platform-wide in MVP (no currency column),
 * and there is no VAT math anywhere — quotation totals are flat sums.
 *
 * Staff enter amounts in baht (satang via a decimal input); display always
 * goes through formatBaht so money looks identical in both UI locales.
 */

/** Just under the Int4 ceiling (~21M฿) — plenty for a garage. */
export const MAX_SATANG = 2_000_000_000;

/**
 * Baht input string → satang, or null when it isn't a valid amount.
 * Accepts "1500", "1,500", "1500.5", "1,500.50", with optional ฿/spaces.
 */
export function bahtToSatang(input: string): number | null {
  const cleaned = input.replace(/[,\s฿]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [baht, fraction = ""] = cleaned.split(".");
  const satang = Number(baht) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(satang) || satang > MAX_SATANG) return null;
  return satang;
}

/** Satang → the plain baht string an <input> should prefill ("1500.50"). */
export function satangToBahtInput(satang: number): string {
  const baht = Math.trunc(satang / 100);
  const rest = satang % 100;
  return rest === 0 ? String(baht) : `${baht}.${String(rest).padStart(2, "0")}`;
}

/**
 * Display form: ฿1,500 / ฿1,500.50. Always th-TH digits-and-symbol so money
 * reads identically in both staff locales; satang shown only when present.
 */
export function formatBaht(satang: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: satang % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(satang / 100);
}
