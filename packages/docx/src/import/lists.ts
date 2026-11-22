/**
 * List reconstruction — Stage 1.5.
 *
 * DOCX lists are flat: paragraphs sit at the body level with a `numPr`
 * tag that points at a numbering definition. ProseMirror lists are
 * nested: `bulletList > listItem+ > paragraph + block*`. This pass
 * walks the flat `DocxImportModel`, groups consecutive paragraphs with
 * the same `numId`, and nests by `ilvl` so the downstream Stage 2
 * transform sees a tree-shaped list block.
 *
 * Bullet vs ordered comes from `numbering.xml` (see `numbering.ts`).
 * Mixed nested lists (bullet inside ordered, e.g.) are handled by
 * keying nested groups on both `numId` and `ilvl`.
 */

import type {
  DocxBlock,
  DocxImportModel,
  DocxListItem,
  DocxParagraphAttrs,
} from "@scrivr/core";
import type { NumberingResolver } from "./numbering";
import type { ParserDiagnostics } from "./parser";
import type { DocxStyleSheet } from "./styles";

/** What `numbering.xml` and the styles mean for list building. */
export interface ListSources {
  numbering: NumberingResolver;
  styles: DocxStyleSheet;
  diagnostics: ParserDiagnostics;
}

/**
 * How far each list has counted, per level: Word counts a `numId` on across
 * the paragraphs between its items, and restarts a level under each new
 * item of a shallower one.
 */
type ListCounts = Map<number, number[]>;

export function reconstructLists(model: DocxImportModel, sources: ListSources): DocxImportModel {
  const { numbering } = sources;
  const counts: ListCounts = new Map();
  const out: DocxBlock[] = [];
  const blocks = model.blocks.map((b) => withResolvedNumbering(b, sources));
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (isListParagraph(b)) {
      // Stop the slice at the first list paragraph whose `numId` differs
      // from this run's, so consecutive bullet + ordered lists become two
      // separate list blocks instead of merging.
      const startIlvl = b.attrs.numbering.ilvl;
      const startNumId = b.attrs.numbering.numId;
      const endIdx = findListEnd(blocks, i, startNumId, startIlvl);
      out.push(...buildLists(blocks.slice(i, endIdx), 0, numbering, counts));
      i = endIdx;
    } else {
      out.push(b);
      i++;
    }
  }
  return { blocks: out };
}

interface ListParagraph {
  type: "paragraph";
  attrs: DocxParagraphAttrs & { numbering: { numId: number; ilvl: number } };
  content: DocxBlock extends infer T
    ? T extends { type: "paragraph"; content: infer C }
      ? C
      : never
    : never;
}

function isListParagraph(b: DocxBlock): b is ListParagraph {
  return b.type === "paragraph" && b.attrs.numbering?.numId !== undefined && b.attrs.numbering.ilvl !== undefined;
}

function findListEnd(
  blocks: DocxBlock[],
  start: number,
  startNumId: number,
  startIlvl: number,
): number {
  let i = start;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (!isListParagraph(b)) break;
    const { numId, ilvl } = b.attrs.numbering;
    if (numId === startNumId) {
      // Same logical list — continue regardless of depth.
      i++;
      continue;
    }
    // Different numId. If we're deeper than the run's starting ilvl, this
    // is a nested sublist with its own numbering definition (e.g. a bullet
    // list nested inside an ordered list, where each list level has a
    // distinct numId per Word's `<w:num>` table). Stay in the run so
    // buildList can attach it to the previous outer item.
    if (ilvl > startIlvl) {
      i++;
      continue;
    }
    // Different numId at the run's starting depth — a new top-level list.
    break;
  }
  return i;
}

/**
 * Build a nested list from a slice of consecutive list paragraphs.
 *
 * The list opens at its first paragraph's `ilvl`; `expectedIlvl` is the level
 * its place puts it at, and items Word starts deeper sit that many levels
 * further in (`levelOffset`), rather than under empty items. Paragraphs
 * deeper than the list's level are nested inside the previous item.
 */
/**
 * Every paragraph of a run, as lists: a list ends where a paragraph sits
 * shallower than the list's own level, and the rest start the next one, so
 * no paragraph is left out.
 */
function buildLists(slice: DocxBlock[], expectedIlvl: number, numbering: NumberingResolver, counts: ListCounts): DocxBlock[] {
  const lists: DocxBlock[] = [];
  let start = 0;
  while (start < slice.length) {
    const built = buildList(slice.slice(start), expectedIlvl, numbering, counts);
    if (!built || built.consumed === 0) {
      // Nothing more makes a list: what is left stays as paragraphs, never lost.
      lists.push(...slice.slice(start).map((b) => (isListParagraph(b) ? stripNumberingMarker(b) : b)));
      break;
    }
    lists.push(built.list);
    start += built.consumed;
  }
  return lists;
}

function buildList(
  slice: DocxBlock[],
  expectedIlvl: number,
  numbering: NumberingResolver,
  counts: ListCounts,
): { list: DocxBlock; consumed: number } | null {
  // Identify the list at this level by its leading paragraph's numId.
  const first = slice[0];
  if (!first || !isListParagraph(first)) return null;
  const numId = first.attrs.numbering.numId;
  const targetIlvl = Math.max(first.attrs.numbering.ilvl, expectedIlvl);
  const listType = numbering.resolve(numId, targetIlvl);
  const format = numbering.format(numId, targetIlvl);
  const levelOffset = targetIlvl - expectedIlvl;
  const counted = counts.get(numId) ?? [];
  counts.set(numId, counted);
  const countedBefore = counted[targetIlvl] ?? 0;

  const items: DocxListItem[] = [];
  let i = 0;
  while (i < slice.length) {
    const b = slice[i]!;
    if (!isListParagraph(b)) {
      // Defensive — shouldn't happen because findListEnd only returns
      // contiguous list paragraphs. Skip.
      i++;
      continue;
    }
    const ilvl = b.attrs.numbering.ilvl;
    if (ilvl < targetIlvl) break; // outer list resumes
    if (ilvl > targetIlvl) {
      // Deeper than target — collect this nested run, attach to last item.
      const nestedStart = i;
      while (
        i < slice.length &&
        isListParagraph(slice[i]!) &&
        (slice[i] as ListParagraph).attrs.numbering.ilvl > targetIlvl
      ) {
        i++;
      }
      // Nested one level below this list's own level, as the editor draws
      // and exports it, whatever this item's offset.
      // A nested run follows an item at this level: the list's first
      // paragraph sits at its own level, so there always is one.
      items[items.length - 1]?.content.push(...buildLists(slice.slice(nestedStart, i), expectedIlvl + 1, numbering, counts));
      continue;
    }
    // ilvl === targetIlvl — new item.
    items.push({ content: [stripNumberingMarker(b)], ...(levelOffset > 0 ? { levelOffset } : {}) });
    counted[targetIlvl] = (counted[targetIlvl] ?? 0) + 1;
    counted.length = targetIlvl + 1;
    i++;
  }

  const start = listType === "ordered" ? numbering.start(numId, targetIlvl) + countedBefore : 1;
  const list: DocxBlock = {
    type: "list",
    listType,
    items,
    level: targetIlvl,
    ...(format !== undefined ? { format } : {}),
    ...(start !== 1 ? { start } : {}),
  };
  return { list, consumed: i };
}

/**
 * A paragraph with the numbering Word draws it with, or none. Its own
 * `numId` and `ilvl` each win over its style's — Word's built-in heading
 * numbering lives on the style — and a level neither names is the one
 * `numbering.xml` links to the style. Word draws no number for `numId` 0, a
 * `numId` the document does not define, or a level formatted `none`.
 */
function withResolvedNumbering(b: DocxBlock, { numbering, styles, diagnostics }: ListSources): DocxBlock {
  if (b.type !== "paragraph") return b;
  const styleId = b.attrs.styleId ?? styles.defaultParagraphStyle;
  const own = b.attrs.numbering ?? {};
  const fromStyle: { numId?: number; ilvl?: number } = styleId === undefined ? {} : styles.numbering(styleId);
  const numId = own.numId ?? fromStyle.numId;
  if (numId === undefined || numId === 0) return withoutNumbering(b);
  if (!numbering.defines(numId)) {
    diagnostics.dropped("w:numPr", "names numbering the document does not define; Word draws no number");
    return withoutNumbering(b);
  }
  const ilvl = Math.min(own.ilvl ?? fromStyle.ilvl ?? (styleId === undefined ? undefined : numbering.levelOfStyle(numId, styleId)) ?? 0, 8);
  if (numbering.format(numId, ilvl) === "none") return withoutNumbering(b);
  return { ...b, attrs: { ...b.attrs, numbering: { numId, ilvl } } };
}

function withoutNumbering(b: DocxBlock & { type: "paragraph" }): DocxBlock {
  if (b.attrs.numbering === undefined) return b;
  const attrs: DocxParagraphAttrs = { ...b.attrs };
  delete attrs.numbering;
  return { ...b, attrs };
}

/**
 * Drop the `numbering` attr from a paragraph before it lands inside an
 * item — once it's nested in a `listItem`, the indent + bullet come from
 * the list structure, not from the now-redundant numPr metadata.
 */
function stripNumberingMarker(p: ListParagraph): DocxBlock {
  const attrs: DocxParagraphAttrs = { ...p.attrs };
  delete attrs.numbering;
  return { type: "paragraph", attrs, content: p.content };
}
