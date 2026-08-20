import { describe, expect, it } from "vitest";
import {
  formatPhone,
  isValidPhone,
  normalizePhone,
  normalizePlate,
} from "@/lib/normalize";

describe("normalizePhone", () => {
  it("strips formatting to bare digits", () => {
    expect(normalizePhone("081-234-5678")).toBe("0812345678");
    expect(normalizePhone("081 234 5678")).toBe("0812345678");
    expect(normalizePhone("(02) 123 4567")).toBe("021234567");
  });

  it("folds the +66 country code to the domestic leading 0", () => {
    expect(normalizePhone("+66 81 234 5678")).toBe("0812345678");
    expect(normalizePhone("66812345678")).toBe("0812345678");
    expect(normalizePhone("+66 2 123 4567")).toBe("021234567");
  });

  it("leaves domestic numbers that merely start with 06 alone", () => {
    expect(normalizePhone("066-123-4567")).toBe("0661234567");
  });

  it("does not fold short digit runs", () => {
    expect(normalizePhone("6681")).toBe("6681");
  });
});

describe("isValidPhone", () => {
  it("accepts 10-digit mobiles and 9-digit landlines", () => {
    expect(isValidPhone("0812345678")).toBe(true);
    expect(isValidPhone("021234567")).toBe(true);
  });

  it("rejects wrong lengths and missing leading 0", () => {
    expect(isValidPhone("812345678")).toBe(false);
    expect(isValidPhone("08123456789")).toBe(false);
    expect(isValidPhone("")).toBe(false);
  });
});

describe("formatPhone", () => {
  it("formats mobiles 3-3-4 and landlines 2-3-4", () => {
    expect(formatPhone("0812345678")).toBe("081-234-5678");
    expect(formatPhone("021234567")).toBe("02-123-4567");
  });

  it("passes anything else through untouched", () => {
    expect(formatPhone("12345")).toBe("12345");
  });
});

describe("normalizePlate", () => {
  it("strips spacing and punctuation", () => {
    expect(normalizePlate("กข 1234")).toBe("กข1234");
    expect(normalizePlate("1 กข 1234")).toBe("1กข1234");
    expect(normalizePlate("ab-1234")).toBe("AB1234");
  });

  it("uppercases Latin and leaves Thai intact", () => {
    expect(normalizePlate("kd 55")).toBe("KD55");
    expect(normalizePlate("ฆค 999")).toBe("ฆค999");
  });
});
