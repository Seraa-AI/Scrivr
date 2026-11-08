import type { Node, NodeType } from "prosemirror-model";
import type { LayoutLine } from "../layout/LineBreaker";
import { DEFAULT_FONT_SIZE_PX, parseFontSizePx } from "../fonts/activeFontSize";

export type ListKind = "bullet" | "ordered";
export type BulletShape = "disc" | "circle" | "square";
export type OrderedFormat = "decimal" | "lowerLetter" | "lowerRoman";

/** How one nesting level of a list looks. Lengths in px at 96 DPI. */
export interface ListLevelStyle {
  /** Left edge of the item's text, measured from the content edge. */
  readonly textIndent: number;
  readonly bullet: { readonly glyph: string; readonly shape: BulletShape };
  readonly ordered: { readonly format: OrderedFormat };
}

/** Word's built-in lists have nine levels; deeper nesting stays at the ninth. */
export const LIST_LEVEL_COUNT = 9;
/** Each level's text sits half an inch further in than the level above. */
const LEVEL_STEP = 48;
/** Every level's marker hangs a quarter inch before its text. */
export const LIST_MARKER_HANGING = 24;
/** Word's default tab stops: every half inch from the content edge. */
export const DEFAULT_TAB_STOP = 48;
/** Least space between a marker's right edge and the item's text. */
export const LIST_MARKER_MIN_GAP = 4;

/**
 * The range a list may start in. The schema allows any integer
 * (`ST_DecimalNumber`); this is Word's documented range for the line-numbering
 * start (MS-OI29500 §17.6.8), the nearest limit Word publishes.
 */
const MIN_START = 0;
const MAX_START = 32767;

/** Bullets and number formats repeat every three levels. */
type Cycle = 0 | 1 | 2;
const cycleOf = (level: number): Cycle => {
  const step = level % 3;
  return step === 0 ? 0 : step === 1 ? 1 : 2;
};

const BULLETS: Readonly<Record<Cycle, ListLevelStyle["bullet"]>> = Object.freeze({
  0: Object.freeze({ glyph: "•", shape: "disc" }),
  1: Object.freeze({ glyph: "◦", shape: "circle" }),
  2: Object.freeze({ glyph: "▪", shape: "square" }),
});
const ORDERED_FORMATS: Readonly<Record<Cycle, OrderedFormat>> = {
  0: "decimal",
  1: "lowerLetter",
  2: "lowerRoman",
};

/** The style of a nesting depth (0 = top level), as Word's built-in lists draw it. */
export function listLevel(depth: number): ListLevelStyle {
  const level = Math.min(Math.max(Math.trunc(depth), 0), LIST_LEVEL_COUNT - 1);
  return {
    textIndent: LEVEL_STEP * (level + 1),
    bullet: BULLETS[cycleOf(level)],
    ordered: { format: ORDERED_FORMATS[cycleOf(level)] },
  };
}

/** A list container: a node whose items are list items. */
export function isListType(type: NodeType): boolean {
  const listItem = type.schema.nodes["listItem"];
  return listItem !== undefined && type.contentMatch.defaultType === listItem;
}

/** Bullet or ordered, for a list container; null for anything else. */
export function listKind(node: Node): ListKind | null {
  if (!isListType(node.type)) return null;
  return node.type.name === "orderedList" ? "ordered" : "bullet";
}

/** The number an ordered list starts at, kept within the range Word accepts. */
export function listStart(node: Node): number {
  const order = node.attrs["order"];
  if (typeof order !== "number" || !Number.isInteger(order)) return 1;
  return Math.min(Math.max(order, MIN_START), MAX_START);
}

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function toRoman(n: number): string {
  let rest = n;
  let out = "";
  for (const [value, numeral] of ROMAN) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

/** Word's lowerLetter: a…z, then aa…zz, then aaa… */
function toLetters(n: number): string {
  const letter = String.fromCharCode(97 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}

const FORMATTERS: Record<OrderedFormat, (n: number) => string> = {
  decimal: (n) => String(n),
  lowerLetter: (n) => (n > 0 ? toLetters(n) : String(n)),
  lowerRoman: (n) => (n > 0 ? toRoman(n) : String(n)),
};

/** The marker of item number `n` (the list's start counts as the first) at `depth`. */
export function listMarker(kind: ListKind, depth: number, n: number): string {
  const level = listLevel(depth);
  return kind === "bullet" ? level.bullet.glyph : `${FORMATTERS[level.ordered.format](n)}.`;
}

const SHAPE_BY_GLYPH: ReadonlyMap<string, BulletShape> = new Map(
  Object.values(BULLETS).map((bullet) => [bullet.glyph, bullet.shape]),
);

/** The shape a bullet marker is drawn as, or null when the marker is text. */
export function bulletShape(marker: string): BulletShape | null {
  return SHAPE_BY_GLYPH.get(marker) ?? null;
}

/** A bullet shape's size and where it sits, relative to the marker's left edge and the baseline. */
export interface BulletBox {
  /** Width and height of the shape. */
  size: number;
  centerAboveBaseline: number;
  /** Line width of the ring. */
  stroke: number;
}

/** The box a bullet is drawn in at `fontSize`. Canvas and PDF both draw from it, so the two agree. */
export function bulletBox(fontSize: number): BulletBox {
  return {
    size: fontSize * 0.3,
    centerAboveBaseline: fontSize * 0.32,
    stroke: fontSize * 0.07,
  };
}

/** The face and size a marker is drawn in. */
export interface ListMarkerFont {
  font: string;
  /** In px; never 0. */
  size: number;
}

const FALLBACK_MARKER_FONT = `${DEFAULT_FONT_SIZE_PX}px Arial, sans-serif`;

/**
 * A marker takes the face and size of the text it labels: the first run of
 * the item's first line. Layout measures it, and canvas and PDF draw it, from
 * this one rule.
 */
export function listMarkerFont(firstLine: LayoutLine | undefined): ListMarkerFont {
  const firstSpan = firstLine?.spans[0];
  const font = firstSpan?.kind === "text" ? firstSpan.font : FALLBACK_MARKER_FONT;
  const parsed = parseFontSizePx(font);
  return { font, size: parsed !== null && parsed > 0 ? parsed : DEFAULT_FONT_SIZE_PX };
}
