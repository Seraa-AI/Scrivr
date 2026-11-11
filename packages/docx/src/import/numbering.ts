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
 * For Scrivr's purposes we only need the bullet/ordered distinction (the
 * exporter uses one numId per type). We pick the format from `ilvl=0` and
 * map decimal / lowerLetter / lowerRoman / upperLetter / upperRoman /
 * ordinal-style formats to `"ordered"`; everything else to `"bullet"`.
 */

import { parseOoxml, findChild, findChildren, attr, type OoxmlElement } from "./xml";

export type ListType = "bullet" | "ordered";

export interface NumberingResolver {
  /** Return the list type for a given numId, or `"bullet"` as a safe default. */
  resolve(numId: number): ListType;
  /** The first number of a level: the list's `startOverride`, else its definition's `w:start`, else 1. */
  start(numId: number, ilvl: number): number;
}

const NONE: NumberingResolver = { resolve: () => "bullet", start: () => 1 };

/** A whole number in an attribute, or undefined. */
function intAttr(el: OoxmlElement | undefined, name: string): number | undefined {
  const raw = el && attr(el, name);
  const value = raw === undefined || raw === null ? NaN : Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

export function readNumberingMap(xml: string | undefined): NumberingResolver {
  if (!xml) return NONE;
  const root = parseOoxml(xml);
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

  // Build abstractNumId → ilvl=0 numFmt
  const abstractFmt = new Map<string, string>();
  for (const aNum of findChildren(root, "w:abstractNum")) {
    const id = attr(aNum, "w:abstractNumId");
    if (!id) continue;
    const lvl = findFirstLevel(aNum);
    if (!lvl) continue;
    const numFmt = findChild(lvl, "w:numFmt");
    const fmt = numFmt && attr(numFmt, "w:val");
    if (fmt) abstractFmt.set(id, fmt);
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

  // Compose numId → ListType
  const cache = new Map<number, ListType>();
  return {
    resolve(numId) {
      const cached = cache.get(numId);
      if (cached) return cached;
      const abstractId = numIdToAbstract.get(String(numId));
      const fmt = abstractId ? abstractFmt.get(abstractId) : undefined;
      const result: ListType = fmt && isOrderedFmt(fmt) ? "ordered" : "bullet";
      cache.set(numId, result);
      return result;
    },
    start(numId, ilvl) {
      const abstractId = numIdToAbstract.get(String(numId));
      return overrideStart.get(String(numId))?.get(ilvl)
        ?? (abstractId ? abstractStart.get(abstractId)?.get(ilvl) : undefined)
        ?? 1;
    },
  };
}

function findFirstLevel(aNum: OoxmlElement): OoxmlElement | undefined {
  // Pick ilvl=0; if absent, take whichever `<w:lvl>` comes first.
  for (const lvl of findChildren(aNum, "w:lvl")) {
    if (attr(lvl, "w:ilvl") === "0") return lvl;
  }
  return findChild(aNum, "w:lvl");
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
