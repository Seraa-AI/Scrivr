import type { DocxMark } from "@scrivr/core";
import { attr, findChild, findChildren, parseOoxml, type OoxmlElement } from "./xml";
import { parseRunProperties } from "./parser";

/**
 * What `word/styles.xml` says a run looks like before anything is written on it
 * directly.
 *
 * Word records most formatting once, in a style, and then says nothing on the
 * runs that use it. A reader that only looks at `<w:rPr>` therefore loses every
 * property the author set through a style — which in a real agreement is most
 * of them, including the document's own default typeface. The MSA's `Normal`
 * style is where `Aptos` at 10.5pt is declared; no run in the file repeats it.
 */
export interface DocxStyleSheet {
  /**
   * The run marks a style contributes, with `docDefaults` and the whole
   * `basedOn` ancestry already folded in. Direct `<w:rPr>` on a run layers over
   * the result.
   */
  runMarks(styleId: string | undefined): readonly DocxMark[];
  /**
   * The style element itself. For properties no generic reader can interpret —
   * a table style's `<w:tblStylePr w:type="band1Horz">` means nothing without
   * knowing which rows band — so the extension that owns them reads them here.
   */
  raw(styleId: string): OoxmlElement | undefined;
}

const EMPTY: DocxStyleSheet = {
  runMarks: () => [],
  raw: () => undefined,
};

export function readStyleSheet(xml: string | undefined): DocxStyleSheet {
  if (xml === undefined) return EMPTY;
  const root = parseOoxml(xml);
  if (!root || root.name !== "w:styles") return EMPTY;

  const byId = new Map<string, OoxmlElement>();
  for (const style of findChildren(root, "w:style")) {
    const id = attr(style, "w:styleId");
    if (id !== undefined) byId.set(id, style);
  }

  const defaults = documentDefaults(root);
  const resolved = new Map<string, readonly DocxMark[]>();

  const runMarks = (styleId: string | undefined): readonly DocxMark[] => {
    if (styleId === undefined) return defaults;
    const cached = resolved.get(styleId);
    if (cached) return cached;

    // Outermost ancestor first, so each style layers over the one it is based
    // on. `seen` stops a `basedOn` cycle — malformed, but a document we are
    // reading is not a document we control.
    const chain: OoxmlElement[] = [];
    const seen = new Set<string>();
    let id: string | undefined = styleId;
    while (id !== undefined && !seen.has(id)) {
      seen.add(id);
      const style = byId.get(id);
      if (!style) break;
      chain.unshift(style);
      id = attr(findChild(style, "w:basedOn") ?? emptyElement, "w:val");
    }

    let marks = defaults;
    for (const style of chain) {
      const rPr = findChild(style, "w:rPr");
      if (rPr) marks = layer(marks, parseRunProperties(rPr));
    }
    resolved.set(styleId, marks);
    return marks;
  };

  return { runMarks, raw: (styleId) => byId.get(styleId) };
}

/** `<w:docDefaults><w:rPrDefault><w:rPr>` — what every style starts from. */
function documentDefaults(root: OoxmlElement): readonly DocxMark[] {
  const docDefaults = findChild(root, "w:docDefaults");
  const rPrDefault = docDefaults && findChild(docDefaults, "w:rPrDefault");
  const rPr = rPrDefault && findChild(rPrDefault, "w:rPr");
  return rPr ? parseRunProperties(rPr) : [];
}

/**
 * `over` wins per property. One `<w:rPr>` child kind is one property, so a
 * style that sets `sz` replaces the inherited `sz` and leaves `rFonts` alone.
 */
export function layer(
  under: readonly DocxMark[],
  over: readonly DocxMark[],
): readonly DocxMark[] {
  if (over.length === 0) return under;
  const byKind = new Map<string, DocxMark>();
  for (const mark of under) byKind.set(mark.kind, mark);
  for (const mark of over) byKind.set(mark.kind, mark);
  return [...byKind.values()];
}

/** A stand-in so a missing `<w:basedOn>` reads as "no value" rather than branching. */
const emptyElement: OoxmlElement = { name: "", attrs: {}, children: [] };
