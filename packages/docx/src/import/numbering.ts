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
}

export function readNumberingMap(xml: string | undefined): NumberingResolver {
  if (!xml) return { resolve: () => "bullet" };
  const root = parseOoxml(xml);
  if (!root || root.name !== "w:numbering") return { resolve: () => "bullet" };

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
