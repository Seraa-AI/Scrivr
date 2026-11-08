import type { Node, NodeType } from "prosemirror-model";

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

/**
 * A list's start is kept within MIN_START–MAX_START. Uncapped, a pasted or
 * synced start of 2³¹ builds a marker millions of characters long. The
 * schema's `ST_DecimalNumber` sets no bound; 32767 is the cap Word documents
 * for the nearest equivalent, the line-numbering start (MS-OI29500 §17.6.8).
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
const ORDERED_FORMATS: Readonly<Record<Cycle, OrderedFormat>> = Object.freeze({
  0: "decimal",
  1: "lowerLetter",
  2: "lowerRoman",
});

/** The style of a nesting depth (0 = top level), as Word's built-in lists draw it. */
export function listLevel(depth: number): ListLevelStyle {
  const level = Math.min(Math.max(depth, 0), LIST_LEVEL_COUNT - 1);
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

/**
 * Bullet or ordered, for a list container; null for anything else. Only an
 * `orderedList` numbers its items; any other list is drawn with bullets.
 */
export function listKind(node: Node): ListKind | null {
  if (!isListType(node.type)) return null;
  return node.type.name === "orderedList" ? "ordered" : "bullet";
}

/** The number an ordered list starts at, kept within MIN_START–MAX_START. */
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

/** The marker at `depth` showing number `n`, already counted from the list's start. */
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

/** A bullet shape's size and where it sits, in px, relative to the marker's left edge and the baseline. */
export interface BulletBox {
  /** Width and height of the shape. */
  size: number;
  /** How far above the line's baseline the shape's centre sits. */
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
