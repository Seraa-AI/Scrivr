import { isListType, outlineLevelOf } from "@scrivr/core";
import type { BlockEntry } from "./id";

const DEFAULT_SHORT_MAX = 200;

/** A block that heads a section: one whose spec declares an outline level. */
function isHeading(node: BlockEntry["node"]): boolean {
  return outlineLevelOf(node) !== null;
}
/** A plain block: the document's default textblock, a paragraph in every built-in schema. */
function isParagraph(node: BlockEntry["node"]): boolean {
  return node.type === node.type.schema.topNodeType.contentMatch.defaultType;
}
function isShort(
  node: BlockEntry["node"],
  max: number,
  textOf: (node: BlockEntry["node"]) => string,
): boolean {
  return textOf(node).length <= max;
}

/**
 * Cohesive-pair grouping over top-level body blocks (document order).
 *
 * v1 ruleset:
 *  - a whole list → one unit;
 *  - a heading immediately followed by exactly ONE short paragraph before the
 *    next heading (or end) → one unit ("section label + lede");
 *  - an orphan / trailing heading → its own standalone unit;
 *  - everything else → one unit per block.
 *
 * image+caption and term+definition are deferred: the schema has no caption or
 * definition-list nodes to group on yet.
 */
export function groupBlocks(
  blocks: BlockEntry[],
  shortBlockMaxChars: number = DEFAULT_SHORT_MAX,
  textOf: (node: BlockEntry["node"]) => string = (node) => node.textContent,
): BlockEntry[][] {
  const groups: BlockEntry[][] = [];
  let i = 0;
  while (i < blocks.length) {
    const entry = blocks[i]!;
    const node = entry.node;

    if (isListType(node.type)) {
      groups.push([entry]);
      i += 1;
      continue;
    }

    if (isHeading(node)) {
      const next = blocks[i + 1];
      const after = blocks[i + 2];
      const pairs =
        next !== undefined &&
        isParagraph(next.node) &&
        isShort(next.node, shortBlockMaxChars, textOf) &&
        (after === undefined || isHeading(after.node));
      if (pairs) {
        groups.push([entry, next]);
        i += 2;
        continue;
      }
      groups.push([entry]);
      i += 1;
      continue;
    }

    groups.push([entry]);
    i += 1;
  }
  return groups;
}
