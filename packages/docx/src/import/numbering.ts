/**
 * Resolve `numId → list type` from `word/numbering.xml`.
 *
 * Word's numbering model:
 *   <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
 *   <w:abstractNum w:abstractNumId="1">
 *     <w:lvl w:ilvl="0"><w:numFmt w:val="bullet|decimal"/></w:lvl>
 *     ...
 *   </w:abstractNum>
 *
 * Each level has its own format (`w:numFmt`): decimal / lowerLetter /
 * lowerRoman / upperLetter / upperRoman / ordinal-style formats are
 * `"ordered"`, everything else `"bullet"`. The format itself is kept, so the
 * list's extension can say when it draws that level differently.
 */

import { parsePart, findChild, findChildren, attr, type OoxmlElement, type ReadTracker } from "./xml";

export type ListType = "bullet" | "ordered";

export interface NumberingResolver {
  /** Word's numbering format at a level (`w:numFmt`), or undefined when the numbering names none. */
  format(numId: number, ilvl: number): string | undefined;
  /** The list type at a level, or `"bullet"` as a safe default. */
  resolve(numId: number, ilvl: number): ListType;
  /** The level whose `w:pStyle` names `styleId` — how Word ties a heading style to a level. */
  levelOfStyle(numId: number, styleId: string): number | undefined;
  /** The first number of a level: the list's `startOverride`, else its definition's `w:start`, else 1. */
  start(numId: number, ilvl: number): number;
}

const NONE: NumberingResolver = { format: () => undefined, levelOfStyle: () => undefined, resolve: () => "bullet", start: () => 1 };

/** A whole number in an attribute, or undefined. */
function intAttr(el: OoxmlElement | undefined, name: string): number | undefined {
  const raw = el && attr(el, name);
  const value = raw === undefined || raw === null ? NaN : Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

export function readNumberingMap(xml: string | undefined, tracker?: ReadTracker): NumberingResolver {
  if (!xml) return NONE;
  const root = parsePart(xml, "word/numbering.xml", tracker);
  if (!root || root.name !== "w:numbering") return NONE;

  // abstractNumId → ilvl → w:start
  const abstractStart = new Map<string, Map<number, number>>();
  for (const aNum of findChildren(root, "w:abstractNum")) {
    const id = attr(aNum, "w:abstractNumId");
    if (!id) continue;
    const starts = new Map<number, number>();
    for (const lvl of findChildren(aNum, "w:lvl")) {
      const ilvl = intAttr(lvl, "w:ilvl");
      const start = intAttr(findChild(lvl, "w:start"), "w:val");
      if (ilvl !== undefined && start !== undefined) starts.set(ilvl, start);
    }
    abstractStart.set(id, starts);
  }

  // numId → ilvl → startOverride
  const overrideStart = new Map<string, Map<number, number>>();
  for (const num of findChildren(root, "w:num")) {
    const id = attr(num, "w:numId");
    if (!id) continue;
    const starts = new Map<number, number>();
    for (const override of findChildren(num, "w:lvlOverride")) {
      const ilvl = intAttr(override, "w:ilvl");
      const start = intAttr(findChild(override, "w:startOverride"), "w:val");
      if (ilvl !== undefined && start !== undefined) starts.set(ilvl, start);
    }
    overrideStart.set(id, starts);
  }

  // abstractNumId → linked paragraph style → ilvl
  const abstractStyleLevel = new Map<string, Map<string, number>>();
  // abstractNumId → ilvl → numFmt
  const abstractFmt = new Map<string, Map<number, string>>();
  for (const aNum of findChildren(root, "w:abstractNum")) {
    const id = attr(aNum, "w:abstractNumId");
    if (!id) continue;
    const formats = new Map<number, string>();
    for (const lvl of findChildren(aNum, "w:lvl")) {
      const ilvl = intAttr(lvl, "w:ilvl");
      const numFmt = findChild(lvl, "w:numFmt");
      const fmt = numFmt && attr(numFmt, "w:val");
      if (ilvl !== undefined && fmt) formats.set(ilvl, fmt);
      const pStyle = findChild(lvl, "w:pStyle");
      const linked = pStyle && attr(pStyle, "w:val");
      if (ilvl !== undefined && linked) {
        const levels = abstractStyleLevel.get(id) ?? new Map<string, number>();
        levels.set(linked, ilvl);
        abstractStyleLevel.set(id, levels);
      }
    }
    abstractFmt.set(id, formats);
  }

  // Build numId → abstractNumId
  const numIdToAbstract = new Map<string, string>();
  for (const num of findChildren(root, "w:num")) {
    const id = attr(num, "w:numId");
    if (!id) continue;
    const ref = findChild(num, "w:abstractNumId");
    const refVal = ref && attr(ref, "w:val");
    if (refVal) numIdToAbstract.set(id, refVal);
  }

  const format = (numId: number, ilvl: number): string | undefined => {
    const abstractId = numIdToAbstract.get(String(numId));
    const formats = abstractId ? abstractFmt.get(abstractId) : undefined;
    // A level the numbering does not define is drawn as its first level.
    return formats?.get(ilvl) ?? formats?.get(0);
  };
  return {
    format,
    levelOfStyle(numId, styleId) {
      const abstractId = numIdToAbstract.get(String(numId));
      return abstractId ? abstractStyleLevel.get(abstractId)?.get(styleId) : undefined;
    },
    resolve(numId, ilvl) {
      const fmt = format(numId, ilvl);
      return fmt && isOrderedFmt(fmt) ? "ordered" : "bullet";
    },
    start(numId, ilvl) {
      const abstractId = numIdToAbstract.get(String(numId));
      return overrideStart.get(String(numId))?.get(ilvl)
        ?? (abstractId ? abstractStart.get(abstractId)?.get(ilvl) : undefined)
        ?? 1;
    },
  };
}

const ORDERED_FORMATS = new Set([
  "decimal",
  "decimalEnclosedCircle",
  "decimalEnclosedFullstop",
  "decimalEnclosedParen",
  "decimalZero",
  "lowerLetter",
  "lowerRoman",
  "upperLetter",
  "upperRoman",
  "ordinal",
  "ordinalText",
  "cardinalText",
]);

function isOrderedFmt(fmt: string): boolean {
  return ORDERED_FORMATS.has(fmt);
}
