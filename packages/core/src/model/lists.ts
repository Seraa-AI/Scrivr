import type { Node, NodeType } from "prosemirror-model";

export type ListKind = "bullet" | "ordered";
export type BulletShape = "disc" | "circle" | "square";
export type OrderedFormat = "decimal" | "lowerLetter" | "lowerRoman";

/** How one nesting level of a list looks. Lengths in px at 96 DPI. */
export interface ListLevelStyle {
  /** Left edge of the item's text, measured from the content edge. */
  textIndent: number;
  /** Distance from the marker's left edge to the text. */
  hanging: number;
  bullet: { glyph: string; shape: BulletShape };
  ordered: { format: OrderedFormat };
}

const HALF_INCH = 48;
const QUARTER_INCH = 24;

const BULLETS: ReadonlyArray<ListLevelStyle["bullet"]> = [
  { glyph: "•", shape: "disc" },
  { glyph: "◦", shape: "circle" },
  { glyph: "▪", shape: "square" },
];
const ORDERED_FORMATS: readonly OrderedFormat[] = ["decimal", "lowerLetter", "lowerRoman"];

/**
 * Word's built-in lists: nine levels, each indenting its text another half
 * inch, with the marker hanging a quarter inch before the text. Bullets and
 * number formats repeat every three levels.
 */
export const LIST_LEVELS: readonly ListLevelStyle[] = Array.from({ length: 9 }, (_, depth) => ({
  textIndent: HALF_INCH * (depth + 1),
  hanging: QUARTER_INCH,
  bullet: BULLETS[depth % BULLETS.length] ?? { glyph: "•", shape: "disc" },
  ordered: { format: ORDERED_FORMATS[depth % ORDERED_FORMATS.length] ?? "decimal" },
}));

const DEEPEST_LEVEL: ListLevelStyle = {
  textIndent: HALF_INCH * LIST_LEVELS.length,
  hanging: QUARTER_INCH,
  bullet: { glyph: "▪", shape: "square" },
  ordered: { format: "lowerRoman" },
};

/** The style of a nesting depth; lists nested past the ninth level stay at the ninth. */
export function listLevel(depth: number): ListLevelStyle {
  return LIST_LEVELS[Math.min(Math.max(depth, 0), LIST_LEVELS.length - 1)] ?? DEEPEST_LEVEL;
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

/** The number an ordered list starts at. */
export function listStart(node: Node): number {
  const order = node.attrs["order"];
  return typeof order === "number" && Number.isInteger(order) ? order : 1;
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

/** The marker of the `n`th item (counting from the list's start) at `depth`. */
export function listMarker(kind: ListKind, depth: number, n: number): string {
  const level = listLevel(depth);
  return kind === "bullet" ? level.bullet.glyph : `${FORMATTERS[level.ordered.format](n)}.`;
}

const SHAPE_BY_GLYPH: ReadonlyMap<string, BulletShape> = new Map(
  BULLETS.map((bullet) => [bullet.glyph, bullet.shape]),
);

/** The shape a bullet marker is drawn as, or null when the marker is text. */
export function bulletShape(marker: string): BulletShape | null {
  return SHAPE_BY_GLYPH.get(marker) ?? null;
}

/**
 * Where a bullet shape sits, relative to the marker's left edge and the line's
 * baseline. Canvas and PDF both draw from this, so the two agree.
 */
export function bulletBox(fontSize: number): { size: number; centerAboveBaseline: number; stroke: number } {
  return {
    size: fontSize * 0.3,
    centerAboveBaseline: fontSize * 0.32,
    stroke: fontSize * 0.07,
  };
}
