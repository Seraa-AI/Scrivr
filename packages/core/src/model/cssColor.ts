/**
 * What a CSS colour literal means, for the lanes that cannot simply hand the
 * string to a painter.
 *
 * Canvas takes a colour as written; PDF wants three floats and DOCX wants six
 * hex digits, so both have to understand the value rather than pass it on. The
 * forms here are the ones a document actually carries: what a browser's CSSOM
 * serialises (`rgb(...)` or a hex triple) and what an author or another editor
 * writes by hand. A named colour resolves in the browser before it is stored;
 * anything still unrecognised here returns null, and the caller omits the fill
 * rather than inventing one.
 */

export interface Rgb {
  /** 0–255. */
  r: number;
  g: number;
  b: number;
}

const HEX = /^#([0-9a-f]{3,8})$/i;
const FUNCTIONAL = /^(rgba?|hsla?)\(([^)]*)\)$/i;

export function parseCssColor(value: string): Rgb | null {
  const trimmed = value.trim();

  const hex = HEX.exec(trimmed);
  if (hex) return fromHex(hex[1]!);

  const fn = FUNCTIONAL.exec(trimmed);
  if (fn) {
    // Both comma- and space-separated argument lists are current CSS, and an
    // alpha may follow a slash. Alpha is dropped: a cell fill is painted onto
    // the page, and neither DOCX shading nor a PDF rectangle carries one.
    const parts = fn[2]!.split(/[\s,/]+/).filter((part) => part !== "");
    return fn[1]!.toLowerCase().startsWith("rgb")
      ? fromRgbArgs(parts)
      : fromHslArgs(parts);
  }

  return null;
}

/** `#rrggbb`, the spelling DOCX shading and other hex-only formats want. */
export function toHex6(colour: Rgb): string {
  return [colour.r, colour.g, colour.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(digits: string): Rgb | null {
  // 4- and 8-digit forms carry an alpha channel this drops.
  const rgb =
    digits.length === 3 || digits.length === 4
      ? digits.slice(0, 3).split("").map((d) => d + d)
      : digits.length === 6 || digits.length === 8
        ? [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)]
        : null;
  if (!rgb) return null;

  const [r, g, b] = rgb.map((pair) => Number.parseInt(pair, 16));
  return r === undefined || g === undefined || b === undefined ? null : { r, g, b };
}

function fromRgbArgs(parts: string[]): Rgb | null {
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map((part) => channel(part, 255));
  const [r, g, b] = channels;
  return r === null || g === null || b === null || r === undefined || g === undefined || b === undefined
    ? null
    : { r, g, b };
}

function fromHslArgs(parts: string[]): Rgb | null {
  if (parts.length < 3) return null;
  const hue = Number.parseFloat(parts[0]!);
  const saturation = percent(parts[1]!);
  const lightness = percent(parts[2]!);
  if (!Number.isFinite(hue) || saturation === null || lightness === null) return null;

  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r1, g1, b1] =
    h < 1 ? [c, x, 0]
    : h < 2 ? [x, c, 0]
    : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c]
    : h < 5 ? [x, 0, c]
    : [c, 0, x];

  const m = lightness - c / 2;
  return {
    r: Math.round((r1! + m) * 255),
    g: Math.round((g1! + m) * 255),
    b: Math.round((b1! + m) * 255),
  };
}

/** One colour channel, written either as a number or as a percentage. */
function channel(part: string, full: number): number | null {
  const value = part.endsWith("%") ? percentTimes(part, full) : Number.parseFloat(part);
  if (value === null || !Number.isFinite(value)) return null;
  return Math.min(full, Math.max(0, Math.round(value)));
}

function percentTimes(part: string, full: number): number | null {
  const fraction = percent(part);
  return fraction === null ? null : fraction * full;
}

/** A percentage as a 0–1 fraction. */
function percent(part: string): number | null {
  if (!part.endsWith("%")) return null;
  const value = Number.parseFloat(part.slice(0, -1));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value / 100)) : null;
}
