/**
 * Dot-matrix numerals and dot fields for the Learning tab. Pure geometry: glyphs are 7 rows tall, drawn as points, so no font
 * asset is needed and the digits look the same on every device. Presentation only; it carries no authority and invents no value.
 */
const ROWS = 7;

const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  ".": ["..", "..", "..", "..", "..", "##", "##"],
  ",": ["..", "..", "..", "..", "##", "##", "#."],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", ".#.##", "#..##"],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
  "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
});

export interface DotPoint { readonly x: number; readonly y: number }
export interface DotLayout { readonly width: number; readonly height: number; readonly dots: readonly DotPoint[] }

/** The minus sign U+2212 is drawn as the hyphen glyph; any other unsupported character becomes a blank, never an exception. */
export function glyphFor(ch: string): readonly string[] {
  const key = ch === "−" ? "-" : ch;
  return GLYPHS[key] ?? GLYPHS[" "];
}

/** True when every character of `text` has a glyph. Callers draw plain text instead when it is false, so a wrong number is never drawn. */
export function isDotSupported(text: string): boolean {
  const chars = Array.from(text);
  return chars.length > 0 && chars.every((ch) => (ch === "\u2212" ? "-" : ch) in GLYPHS);
}

/** Lays out `text` on a square pitch grid. One blank column separates glyphs. Coordinates are dot centres. */
export function layoutDotMatrix(text: string, pitch: number): DotLayout {
  if (!Number.isFinite(pitch) || pitch <= 0) return Object.freeze({ width: 0, height: 0, dots: Object.freeze([]) });
  const dots: DotPoint[] = [];
  let col = 0;
  for (const ch of Array.from(text)) {
    const rows = glyphFor(ch);
    const width = rows[0].length;
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < width; c += 1) if (rows[r][c] === "#") dots.push(Object.freeze({ x: (col + c + 0.5) * pitch, y: (r + 0.5) * pitch }));
    }
    col += width + 1;
  }
  return Object.freeze({ width: Math.max(0, col - 1) * pitch, height: ROWS * pitch, dots: Object.freeze(dots) });
}

/**
 * Which `lit` of `total` dots light up. The COUNT is the real value; WHICH cells light is a fixed, evenly spread pattern (no
 * claim that a given setting is a given cell). Deterministic, no duplicates, always exactly min(lit, total) indices.
 */
export function litIndices(total: number, lit: number): readonly number[] {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(lit) || lit <= 0) return Object.freeze([]);
  const count = Math.min(lit, total);
  const picked = new Set<number>();
  const golden = 0.6180339887498949;
  let i = 0;
  while (picked.size < count && i < total * 4) {
    picked.add(Math.floor(((i + 1) * golden % 1) * total));
    i += 1;
  }
  for (let k = 0; picked.size < count && k < total; k += 1) picked.add(k);
  return Object.freeze(Array.from(picked).sort((a, b) => a - b));
}

export interface DotFieldLayout { readonly columns: number; readonly rows: number; readonly width: number; readonly height: number }

export function dotFieldLayout(total: number, columns: number, pitch: number): DotFieldLayout {
  const cols = Math.max(1, Math.floor(columns));
  const rows = total > 0 ? Math.ceil(total / cols) : 0;
  return Object.freeze({ columns: cols, rows, width: cols * pitch, height: rows * pitch });
}

/** The largest pitch (<= maxPitch, in 0.5 steps) at which `text` fits `maxWidth`, so long amounts shrink instead of overflowing. */
export function fitPitch(text: string, maxWidth: number, maxPitch: number): number {
  const columns = layoutDotMatrix(text, 1).width;
  if (!(columns > 0) || !Number.isFinite(maxWidth) || maxWidth <= 0 || !Number.isFinite(maxPitch) || maxPitch <= 0) return Math.max(0, Number.isFinite(maxPitch) ? maxPitch : 0);
  return Math.max(1, Math.min(maxPitch, Math.floor((maxWidth / columns) * 2) / 2));
}
