import { describe, expect, it } from "vitest";
import { encodeQr, qrDataCodewords, qrPath, qrVersionFor } from "@/lib/qr";

/**
 * The in-repo QR encoder (M7.8 §8) is checked against ISO 18004 by hand: the
 * byte-mode bit stream for a known input, version selection at the capacity
 * edges, the fixed function patterns, and a format-information word that
 * decodes to level M with a valid BCH remainder. (During the build every
 * symbol here was also round-tripped through a third-party decoder.)
 */

/** Read the 15 format bits back from a symbol, in the standard's layout. */
function formatWord(matrix: boolean[][]): number {
  const bit = (x: number, y: number) => (matrix[y][x] ? 1 : 0);
  const bits = [
    ...[0, 1, 2, 3, 4, 5].map((i) => bit(8, i)),
    bit(8, 7),
    bit(8, 8),
    bit(7, 8),
    ...[9, 10, 11, 12, 13, 14].map((i) => bit(14 - i, 8)),
  ];
  return bits.reduce((acc, b, i) => acc | (b << i), 0) ^ 0x5412;
}

describe("qr encoder", () => {
  it("encodes byte mode exactly as the standard lays it out", () => {
    // 0100 | 00000101 | H E L L O | 0000 terminator | pad EC 11 EC 11 …
    expect(qrDataCodewords("HELLO").map((b) => b.toString(16).padStart(2, "0"))).toEqual([
      "40", "54", "84", "54", "c4", "c4", "f0", "ec", "11", "ec", "11", "ec", "11", "ec", "11", "ec",
    ]);
  });

  it("picks the smallest version that fits, up to version 10", () => {
    expect(qrVersionFor(14)).toBe(1); // 4 + 8 + 14*8 = 124 bits ≤ 128
    expect(qrVersionFor(15)).toBe(2);
    expect(qrVersionFor(62)).toBe(4); // a full form URL fits version 4
    expect(qrVersionFor(63)).toBe(5);
    expect(qrVersionFor(213)).toBe(10);
    expect(() => qrVersionFor(214)).toThrow();
  });

  it("draws a symbol of the right size with the three finders and the dark module", () => {
    const m = encodeQr("https://automotive-oa.vercel.app/a/AbCdEfGhIjKlMnOpQrStUv");
    expect(m.length).toBe(33); // version 4
    for (const [cx, cy] of [
      [3, 3],
      [29, 3],
      [3, 29],
    ]) {
      expect(m[cy][cx]).toBe(true); // centre
      expect(m[cy - 2][cx - 2]).toBe(false); // the light ring
      expect(m[cy - 3][cx - 3]).toBe(true); // the outer ring
    }
    expect(m[33 - 8][8]).toBe(true); // dark module
    // Timing patterns alternate, undisturbed by the format area (row/col 6).
    for (let i = 8; i < 33 - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
  });

  it("writes a format word for level M whose BCH remainder is zero", () => {
    const word = formatWord(encodeQr("HELLO"));
    expect(word >> 13).toBe(0b00); // level M
    let rem = word;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    expect(rem).toBe(0);
  });

  it("renders every dark module as one unit square", () => {
    const m = encodeQr("HELLO");
    const dark = m.flat().filter(Boolean).length;
    expect(qrPath(m).split("z").length - 1).toBe(dark);
  });
});
