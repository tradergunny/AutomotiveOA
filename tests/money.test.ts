import { describe, expect, it } from "vitest";
import { bahtToSatang, formatBaht, MAX_SATANG, satangToBahtInput } from "@/lib/money";

// Money ruling (M4 brief): integer satang, exact arithmetic, THB implicit.

describe("bahtToSatang", () => {
  it("parses whole baht", () => {
    expect(bahtToSatang("1500")).toBe(150_000);
    expect(bahtToSatang("0")).toBe(0);
  });

  it("accepts thousands separators, ฿, and stray spaces", () => {
    expect(bahtToSatang("1,500")).toBe(150_000);
    expect(bahtToSatang("฿1,500.50")).toBe(150_050);
    expect(bahtToSatang(" 1500 ")).toBe(150_000);
  });

  it("parses one or two satang digits exactly", () => {
    expect(bahtToSatang("1500.5")).toBe(150_050);
    expect(bahtToSatang("1500.55")).toBe(150_055);
    expect(bahtToSatang("0.05")).toBe(5);
  });

  it("rejects non-amounts", () => {
    expect(bahtToSatang("")).toBeNull();
    expect(bahtToSatang("abc")).toBeNull();
    expect(bahtToSatang("-5")).toBeNull();
    expect(bahtToSatang("1.234")).toBeNull(); // three satang digits
    expect(bahtToSatang("1.500,50")).toBeNull(); // wrong separator convention
  });

  it("rejects amounts beyond the Int4-safe cap", () => {
    expect(bahtToSatang(String(MAX_SATANG / 100))).toBe(MAX_SATANG);
    expect(bahtToSatang(String(MAX_SATANG / 100 + 1))).toBeNull();
    expect(bahtToSatang("999999999999999999")).toBeNull();
  });
});

describe("satangToBahtInput", () => {
  it("round-trips whole baht without decimals", () => {
    expect(satangToBahtInput(150_000)).toBe("1500");
  });

  it("keeps two satang digits when present", () => {
    expect(satangToBahtInput(150_050)).toBe("1500.50");
    expect(satangToBahtInput(5)).toBe("0.05");
  });
});

describe("formatBaht", () => {
  const clean = (value: string) => value.replace(/ /g, " ");

  it("shows whole amounts without satang", () => {
    expect(clean(formatBaht(150_000))).toContain("1,500");
    expect(clean(formatBaht(150_000))).not.toContain(".00");
  });

  it("shows satang when present", () => {
    expect(clean(formatBaht(150_050))).toContain("1,500.50");
  });

  it("always carries the baht symbol", () => {
    expect(formatBaht(150_000)).toContain("฿");
  });
});
