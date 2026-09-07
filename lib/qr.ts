/**
 * A small QR encoder (M7.8 brief §8): the Arrival form's counter poster
 * needs a QR of a ~60-character URL, and pulling a dependency (or sending
 * the Shop's form token to a third-party image service) for that is worse
 * than 250 lines of ISO 18004 in-repo. Byte mode, error correction level M,
 * versions 1–10 (up to 213 bytes), automatic mask selection. Output is a
 * boolean matrix the caller renders as SVG. Pure and unit-tested.
 */

export type QrMatrix = boolean[][];

/* ---- Reed–Solomon over GF(256), polynomial 0x11D ---- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const out = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) out[j] ^= mul(gen[j + 1], factor);
    }
  }
  return out;
}

/* ---- Version tables, error correction level M ---- */

type VersionSpec = {
  /** Error-correction codewords per block. */
  ec: number;
  /** [count, dataCodewords] groups, in order. */
  blocks: [number, number][];
  /** Alignment-pattern centre coordinates (both axes). */
  align: number[];
  /** Remainder bits after the last codeword. */
  remainder: number;
};

const VERSIONS: Record<number, VersionSpec> = {
  1: { ec: 10, blocks: [[1, 16]], align: [], remainder: 0 },
  2: { ec: 16, blocks: [[1, 28]], align: [6, 18], remainder: 7 },
  3: { ec: 26, blocks: [[1, 44]], align: [6, 22], remainder: 7 },
  4: { ec: 18, blocks: [[2, 32]], align: [6, 26], remainder: 7 },
  5: { ec: 24, blocks: [[2, 43]], align: [6, 30], remainder: 7 },
  6: { ec: 16, blocks: [[4, 27]], align: [6, 34], remainder: 7 },
  7: { ec: 18, blocks: [[4, 31]], align: [6, 22, 38], remainder: 0 },
  8: { ec: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42], remainder: 0 },
  9: { ec: 22, blocks: [[3, 36], [2, 37]], align: [6, 26, 46], remainder: 0 },
  10: { ec: 26, blocks: [[4, 43], [1, 44]], align: [6, 28, 50], remainder: 0 },
};

function dataCapacity(spec: VersionSpec): number {
  return spec.blocks.reduce((sum, [count, size]) => sum + count * size, 0);
}

/** Smallest version whose byte-mode capacity fits `length` bytes. */
export function qrVersionFor(length: number): number {
  for (let version = 1; version <= 10; version++) {
    const countBits = version < 10 ? 8 : 16;
    const needed = 4 + countBits + length * 8;
    if (needed <= dataCapacity(VERSIONS[version]) * 8) return version;
  }
  throw new Error(`qr: payload of ${length} bytes exceeds version 10`);
}

/* ---- Bit assembly ---- */

function encodeData(bytes: Uint8Array, version: number): number[] {
  const spec = VERSIONS[version];
  const capacity = dataCapacity(spec);
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  // Terminator (up to four zeros), then pad to a byte boundary.
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

function interleave(codewords: number[], version: number): number[] {
  const spec = VERSIONS[version];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [count, size] of spec.blocks) {
    for (let i = 0; i < count; i++) {
      const block = codewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, spec.ec));
    }
  }
  const out: number[] = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/** The data codewords before interleaving — exposed for the unit test. */
export function qrDataCodewords(text: string): number[] {
  const bytes = new TextEncoder().encode(text);
  return encodeData(bytes, qrVersionFor(bytes.length));
}

/* ---- Matrix ---- */

type Grid = { size: number; cells: Uint8Array; reserved: Uint8Array };

const at = (grid: Grid, x: number, y: number) => grid.cells[y * grid.size + x] === 1;

function set(grid: Grid, x: number, y: number, dark: boolean, reserve = true) {
  grid.cells[y * grid.size + x] = dark ? 1 : 0;
  if (reserve) grid.reserved[y * grid.size + x] = 1;
}

function drawFinder(grid: Grid, cx: number, cy: number) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(grid, x, y, d !== 2 && d !== 4);
    }
  }
}

function drawAlignment(grid: Grid, cx: number, cy: number) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(grid, cx + dx, cy + dy, d !== 1);
    }
  }
}

function drawFunctionPatterns(grid: Grid, version: number) {
  const { size } = grid;
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);
  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(grid, i, 6, i % 2 === 0);
    set(grid, 6, i, i % 2 === 0);
  }
  // Alignment patterns, skipping the three finder corners.
  const align = VERSIONS[version].align;
  for (const cx of align) {
    for (const cy of align) {
      const corner =
        (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
      if (!corner) drawAlignment(grid, cx, cy);
    }
  }
  // Format-information areas (filled later) and the dark module. Row and
  // column 6 belong to the timing patterns drawn above and are skipped.
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    set(grid, i, 8, false);
    set(grid, 8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    set(grid, size - 1 - i, 8, false);
    set(grid, 8, size - 1 - i, false);
  }
  set(grid, 8, size - 8, true);
  // Version information (versions 7 and up).
  if (version >= 7) {
    const bits = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(grid, a, b, bit);
      set(grid, b, a, bit);
    }
  }
}

function placeData(grid: Grid, codewords: number[], version: number) {
  const { size } = grid;
  const bits: number[] = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  for (let i = 0; i < VERSIONS[version].remainder; i++) bits.push(0);
  let index = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (grid.reserved[y * size + x]) continue;
        const bit = index < bits.length ? bits[index] : 0;
        index += 1;
        grid.cells[y * size + x] = bit;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number) {
  const fn = MASKS[mask];
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!grid.reserved[y * grid.size + x] && fn(x, y)) grid.cells[y * grid.size + x] ^= 1;
    }
  }
}

/** BCH(15,5) format information for level M and the given mask. */
function bchFormat(mask: number): number {
  const data = (0b00 << 3) | mask; // level M is 00
  let value = data << 10;
  for (let i = 14; i >= 10; i--) if ((value >> i) & 1) value ^= 0x537 << (i - 10);
  return ((data << 10) | value) ^ 0x5412;
}

/** BCH(18,6) version information. */
function bchVersion(version: number): number {
  let value = version << 12;
  for (let i = 17; i >= 12; i--) if ((value >> i) & 1) value ^= 0x1f25 << (i - 12);
  return (version << 12) | value;
}

function writeFormat(grid: Grid, mask: number) {
  const { size } = grid;
  const bits = bchFormat(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;
  // Around the top-left finder.
  for (let i = 0; i <= 5; i++) set(grid, 8, i, bit(i));
  set(grid, 8, 7, bit(6));
  set(grid, 8, 8, bit(7));
  set(grid, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(grid, 14 - i, 8, bit(i));
  // Beside the other two finders.
  for (let i = 0; i < 8; i++) set(grid, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(grid, 8, size - 15 + i, bit(i));
}

function penalty(grid: Grid): number {
  const { size } = grid;
  let score = 0;
  // N1: runs of five or more same-coloured modules in a row or column.
  for (let y = 0; y < size; y++) {
    let runX = 1;
    let runY = 1;
    for (let x = 1; x < size; x++) {
      runX = at(grid, x, y) === at(grid, x - 1, y) ? runX + 1 : 1;
      if (runX === 5) score += 3;
      else if (runX > 5) score += 1;
      runY = at(grid, y, x) === at(grid, y, x - 1) ? runY + 1 : 1;
      if (runY === 5) score += 3;
      else if (runY > 5) score += 1;
    }
  }
  // N2: 2×2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = at(grid, x, y);
      if (c === at(grid, x + 1, y) && c === at(grid, x, y + 1) && c === at(grid, x + 1, y + 1)) score += 3;
    }
  }
  // N3: finder-like 1:1:3:1:1 patterns with four light modules on a side.
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const light4 = [0, 0, 0, 0];
  const matches = (seq: number[], start: number, ref: number[]) =>
    ref.every((v, i) => seq[start + i] === v);
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    const col: number[] = [];
    for (let j = 0; j < size; j++) {
      row.push(at(grid, j, i) ? 1 : 0);
      col.push(at(grid, i, j) ? 1 : 0);
    }
    for (const line of [row, col]) {
      for (let j = 0; j + 11 <= size; j++) {
        if (
          (matches(line, j, light4) && matches(line, j + 4, pattern)) ||
          (matches(line, j, pattern) && matches(line, j + 7, light4))
        ) {
          score += 40;
        }
      }
    }
  }
  // N4: dark-module proportion away from 50%.
  let dark = 0;
  for (let i = 0; i < size * size; i++) dark += grid.cells[i];
  const percent = (dark * 100) / (size * size);
  const step = Math.floor(Math.abs(percent - 50) / 5);
  score += step * 10;
  return score;
}

/** Encode `text` (UTF-8) as a QR symbol, level M, best mask. */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = qrVersionFor(bytes.length);
  const codewords = interleave(encodeData(bytes, version), version);
  const size = 17 + 4 * version;

  const base: Grid = { size, cells: new Uint8Array(size * size), reserved: new Uint8Array(size * size) };
  drawFunctionPatterns(base, version);
  placeData(base, codewords, version);

  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid: Grid = { size, cells: base.cells.slice(), reserved: base.reserved.slice() };
    applyMask(grid, mask);
    writeFormat(grid, mask);
    const score = penalty(grid);
    if (score < bestScore) {
      bestScore = score;
      best = grid;
    }
  }

  const matrix: QrMatrix = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(at(best!, x, y));
    matrix.push(row);
  }
  return matrix;
}

/** One SVG path (`d`) drawing every dark module as a unit square. */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join("");
}
