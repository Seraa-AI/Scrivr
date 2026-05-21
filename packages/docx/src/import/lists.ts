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

export function reconstructLists(
  model: DocxImportModel,
  numbering: NumberingResolver,
): DocxImportModel {
  const out: DocxBlock[] = [];
  const blocks = model.blocks;
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (isListParagraph(b)) {
      // Stop the slice at the first list paragraph whose `numId` differs
      // from this run's, so consecutive bullet + ordered lists become two
      // separate list blocks instead of merging.
      const startIlvl = b.attrs.numbering.ilvl;
      const startNumId = b.attrs.numbering.numId;
      const endIdx = findListEnd(blocks, i, startNumId);
      const slice = blocks.slice(i, endIdx);
      const list = buildList(slice, startIlvl, numbering);
      if (list) out.push(list);
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
  return b.type === "paragraph" && b.attrs.numbering !== undefined;
}

function findListEnd(blocks: DocxBlock[], start: number, numId: number): number {
  let i = start;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (!isListParagraph(b)) break;
    // Same list run only if numId matches. Nested levels share numId in
    // Word's output for a single logical list; switching numId means a
    // new list starts here.
    if (b.attrs.numbering.numId !== numId) break;
    i++;
  }
  return i;
}

/**
 * Build a nested list from a slice of consecutive list paragraphs.
 *
 * `targetIlvl` is the ilvl at which to open items here; paragraphs deeper
 * than that get attached as nested lists inside the previous item.
 */
function buildList(
  slice: DocxBlock[],
  targetIlvl: number,
  numbering: NumberingResolver,
): DocxBlock | null {
  // Identify the list at this level by its leading paragraph's numId.
  const first = slice[0];
  if (!first || !isListParagraph(first)) return null;
  const numId = first.attrs.numbering.numId;
  const listType = numbering.resolve(numId);

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
      const nested = buildList(slice.slice(nestedStart, i), targetIlvl + 1, numbering);
      if (nested && items.length > 0) {
        items[items.length - 1]!.content.push(nested);
      } else if (nested) {
        // No prior item — open a synthetic one to host the nested list.
        items.push({ content: [nested] });
      }
      continue;
    }
    // ilvl === targetIlvl — new item.
    items.push({ content: [stripNumberingMarker(b)] });
    i++;
  }

  return { type: "list", listType, items };
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
