import { CSS_COLOR_NAMES } from "./cssColorNames";

/**
 * What a CSS colour literal means, for the lanes that cannot hand the string to
 * a painter.
 *
 * Canvas takes a colour as written; PDF wants three floats and DOCX six hex
 * digits, so both have to understand the value rather than pass it on. Nothing
 * here touches the DOM: a document exported on a server has no CSSOM to ask,
 * and its `background: red` has to mean red there too.
 */

export interface Rgb {
  /** sRGB channels, 0–255. */
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  /** Opacity, 0–1. Exporters decide how to represent transparency. */
  alpha: number;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Resolve an sRGB literal without a DOM: named colors, hex, RGB and HSL.
 * Context-dependent and unsupported color spaces return null. Keep alpha until
 * the output boundary so a transparent fill never becomes an opaque one.
 */
export function parseCssColor(value: string): Rgba | null {
  const literal = value.trim().toLowerCase();
  if (literal === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };
  // A bare index also finds `constructor` and `toString` on the prototype, so
  // the value has to be a string, not merely present.
  const named = CSS_COLOR_NAMES[literal];
  if (typeof named === "string") return fromHex(named);

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(literal);
  if (hex) return fromHex(hex[1]!);

  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(literal);
  if (!fn) return null;
  const args = colorArguments(fn[2]!);
  if (!args) return null;
  const alpha = args.alpha === undefined ? 1 : channel(args.alpha, 1);
  if (alpha === null) return null;
  const rgb = fn[1]!.startsWith("rgb") ? fromRgb(args.channels) : fromHsl(args.channels);
  return rgb ? { ...rgb, alpha } : null;
}

/** Composite onto an opaque background when the output format has no alpha. */
export function compositeColor(foreground: Rgba, background: Rgb): Rgb {
  const blend = (front: number, back: number) => front * foreground.alpha + back * (1 - foreground.alpha);
  return {
    r: blend(foreground.r, background.r),
    g: blend(foreground.g, background.g),
    b: blend(foreground.b, background.b),
  };
}

/**
 * Six hex digits for an opaque RGB color. Translucency has to be composited
 * first, which the parameter enforces: an `Rgba` does not fit it, so a caller
 * holding one cannot silently drop the alpha.
 */
export function toHex6(colour: Rgb & { alpha?: undefined }): string {
  return [colour.r, colour.g, colour.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(digits: string): Rgba {
  const expanded = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
  };
}

type Channels = [string, string, string];

function colorArguments(body: string): { channels: Channels; alpha?: string } | null {
  let channels: string[];
  let alpha: string | undefined;
  if (body.includes(",")) {
    if (body.includes("/")) return null;
    const parts = body.split(",").map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    channels = parts.slice(0, 3);
    alpha = parts[3];
  } else {
    const parts = body.split("/");
    if (parts.length > 2) return null;
    channels = parts[0]!.trim().split(/\s+/);
    alpha = parts[1]?.trim();
  }
  const [first, second, third] = channels;
  if (first === undefined || second === undefined || third === undefined || channels.length !== 3) {
    return null;
  }
  return { channels: [first, second, third], ...(alpha === undefined ? {} : { alpha }) };
}

function fromRgb(parts: Channels): Rgb | null {
  const r = channel(parts[0], 255);
  const g = channel(parts[1], 255);
  const b = channel(parts[2], 255);
  return r === null || g === null || b === null ? null : { r, g, b };
}

function fromHsl(parts: Channels): Rgb | null {
  const angle = /^(.+?)(deg|grad|rad|turn)?$/.exec(parts[0]);
  const hue = angle ? numeric(angle[1]!) : null;
  // CSS Color 4 allows a bare number as well as a percentage for these two.
  const saturation = fraction(parts[1]);
  const lightness = fraction(parts[2]);
  if (hue === null || saturation === null || lightness === null) return null;
  const unit = angle?.[2];
  const fullTurn = unit === "turn" ? 1 : unit === "rad" ? 2 * Math.PI : unit === "grad" ? 400 : 360;
  // Reduce before converting units, keeping even very large finite angles finite.
  const h = (((hue % fullTurn) + fullTurn) % fullTurn) / fullTurn * 6;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b]: [number, number, number] =
    h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const m = lightness - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function numeric(value: string): number | null {
  if (!NUMBER.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function channel(value: string, maximum: number): number | null {
  const number = value.endsWith("%") ? percentage(value) : numeric(value);
  if (number === null) return null;
  return Math.min(maximum, Math.max(0, value.endsWith("%") ? number * maximum : number));
}

/** A percentage as a 0–1 fraction. */
function percentage(value: string): number | null {
  if (!value.endsWith("%")) return null;
  const number = numeric(value.slice(0, -1));
  return number === null ? null : Math.min(1, Math.max(0, number / 100));
}

/** A percentage, or the bare number CSS Color 4 accepts in its place, as 0–1. */
function fraction(value: string): number | null {
  if (value.endsWith("%")) return percentage(value);
  const number = numeric(value);
  return number === null ? null : Math.min(1, Math.max(0, number / 100));
}
