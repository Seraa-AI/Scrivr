import type { BlockEntry } from "./id";

const DEFAULT_SHORT_MAX = 200;

function isList(node: BlockEntry["node"]): boolean {
  const n = node.type.name;
  return n === "bulletList" || n === "orderedList";
}
function isHeading(node: BlockEntry["node"]): boolean {
  return node.type.name === "heading";
}
function isParagraph(node: BlockEntry["node"]): boolean {
  return node.type.name === "paragraph";
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

    if (isList(node)) {
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
