/**
 * CSS values read off HTML into the editor's units. Parse rules share these so
 * one written value means the same thing on every element that carries it.
 */

/** Pixels in one absolute unit, at CSS's 96 dpi. A bare number is px. */
const PX_PER_UNIT: Record<string, number> = {
  "": 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
};

/** The browser's default text size, which `em`/`rem` resolve against when nothing says otherwise. */
export const DEFAULT_FONT_PX = 16;

/** A CSS length's number and lowercased unit (`""` when bare), or null when it is not one. */
export function parseCssLength(value: string): { amount: number; unit: string } | null {
  const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return null;
  return { amount: parseFloat(match[1] ?? ""), unit: (match[2] ?? "").toLowerCase() };
}

/**
 * A CSS length in px, or null when it is not one (a `%`, a keyword, empty).
 * `em`/`rem` resolve only against a font size the caller supplies: a margin
 * can assume the default text size, a table column cannot know its text's.
 */
export function cssLengthToPx(value: string, emPx?: number): number | null {
  const length = parseCssLength(value);
  if (!length) return null;
  if (length.unit === "em" || length.unit === "rem") return emPx === undefined ? null : length.amount * emPx;
  // `hasOwn`: a unit spelled `constructor` must not find Object's.
  const perUnit = Object.hasOwn(PX_PER_UNIT, length.unit) ? PX_PER_UNIT[length.unit] : undefined;
  return perUnit === undefined ? null : length.amount * perUnit;
}

/** `inherit`, `initial` and the like: a keyword standing in for a value it does not state. */
export function isCssWideKeyword(value: string): boolean {
  return /^\s*(inherit|initial|unset|revert|revert-layer)\s*$/i.test(value);
}

/**
 * `initial`: back to the property's default, so a value inherited from outside
 * stops here. Not `revert`, which on inline text falls back to the browser's
 * own style — and that inherits.
 */
export function isCssReset(value: string): boolean {
  return /^\s*initial\s*$/i.test(value);
}

export type TextAlign = "left" | "center" | "right" | "justify";

const TEXT_ALIGN: Record<string, TextAlign> = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  justify: "justify",
};

/** `text-align` as one of the editor's four; anything else is left. */
export function cssTextAlign(value: string): TextAlign {
  return TEXT_ALIGN[value.trim().toLowerCase()] ?? "left";
}

/** The first family of a `font-family` stack, unquoted — `"Arial", sans-serif` → `Arial`. */
export function cssPrimaryFamily(value: string): string | null {
  return value.replace(/['"]/g, "").split(",")[0]?.trim() || null;
}

const FONT_SIZE_PX = [10, 13, 16, 18, 24, 32, 48];

/** `<font size>` 1–7, or relative `+n`/`-n` from 3, in px. */
export function htmlFontSizeToPx(value: string): number | null {
  const raw = value.trim();
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  const step = /^[+-]/.test(raw) ? 3 + n : n;
  return FONT_SIZE_PX[Math.min(Math.max(step, 1), 7) - 1] ?? null;
}
