/**
 * CSS values read off HTML into the editor's units. Parse rules share these so
 * one written value means the same thing on every element that carries it.
 */

/** Pixels in one unit, at CSS's 96 dpi. `em`/`rem` take the 16px default. */
const PX_PER_UNIT: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  em: 16,
  rem: 16,
};

/** A CSS length in px, or null when it is not one (a `%`, a keyword, empty). A bare number is px. */
export function cssLengthToPx(value: string): number | null {
  const match = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return null;
  const amount = parseFloat(match[1] ?? "");
  const perUnit = PX_PER_UNIT[(match[2] || "px").toLowerCase()];
  return perUnit === undefined || Number.isNaN(amount) ? null : amount * perUnit;
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

/** `<font size>` 1–7, or relative `+n`/`-n` from 3, in px. */
const FONT_SIZE_PX = [10, 13, 16, 18, 24, 32, 48];

export function htmlFontSizeToPx(value: string): number | null {
  const raw = value.trim();
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  const step = /^[+-]/.test(raw) ? 3 + n : n;
  return FONT_SIZE_PX[Math.min(Math.max(step, 1), 7) - 1] ?? null;
}
