import { isListType } from "@scrivr/core";
import { Node as PMNode, Schema } from "@scrivr/core/pm";

import { ListLevel } from "../types";

/** A block at the bottom of the list structure, with where it sits in it. */
export interface ListLeaf {
  node: PMNode;
  pos: number;
  list: ListLevel[];
  /** Where each list it sits in starts, outermost first. */
  listsAt: number[];
}

/**
 * The blocks under `parent`, each with the lists it sits in. A block that is
 * not a list or list item is a leaf, however much it holds.
 */
export function listLeaves(parent: PMNode, offset = 0, list: ListLevel[] = []): ListLeaf[] {
  const leaves: ListLeaf[] = [];
  parent.forEach((child, childOffset) => {
    const pos = offset + childOffset;
    if (!isListType(child.type)) {
      leaves.push({ node: child, pos, list, listsAt: [] });
      return;
    }
    child.forEach((item, itemOffset) => {
      const itemPos = pos + 1 + itemOffset;
      listLeaves(item, itemPos + 1, []).forEach((leaf, index) => {
        const level: ListLevel = {
          type: child.type.name,
          attrs: { ...child.attrs },
          item: { ...item.attrs },
          startsItem: index === 0,
        };
        leaves.push({ ...leaf, list: [...list, level, ...leaf.list], listsAt: [pos, ...leaf.listsAt] });
      });
    });
  });
  return leaves;
}

/**
 * The same list, by kind and settings, and by id once both have one. A list
 * made by the edit being recorded gets its id only afterwards, so a block's
 * earlier place cannot always name it. Records are about the list, not where
 * it is, so they are left out.
 */
const sameLevel = (a: ListLevel, b: ListLevel) => {
  const { nodeId: aId, dataTracked: _, ...aSettings } = a.attrs;
  const { nodeId: bId, dataTracked: __, ...bSettings } = b.attrs;
  return a.type === b.type && JSON.stringify(aSettings) === JSON.stringify(bSettings) &&
    (!aId || !bId || aId === bId);
};

export const sameList = (a: ListLevel[], b: ListLevel[]) =>
  a.length === b.length &&
  a.every((level, depth) => sameLevel(level, b[depth]!) && level.startsItem === b[depth]!.startsItem);

/**
 * Builds the blocks back from where each says it sits. Consecutive blocks in
 * the same list share one container, and a block that started an item starts
 * one again. Containers keep the attrs, records included, of the first block
 * that names them.
 */
export function buildLists(leaves: Array<{ node: PMNode; list: ListLevel[] }>, schema: Schema, depth = 0): PMNode[] {
  const out: PMNode[] = [];
  let i = 0;
  while (i < leaves.length) {
    const leaf = leaves[i]!;
    const level = leaf.list[depth];
    if (!level) {
      out.push(leaf.node);
      i++;
      continue;
    }
    let end = i + 1;
    while (end < leaves.length && leaves[end]!.list[depth] && sameLevel(leaves[end]!.list[depth]!, level)) end++;
    const run = leaves.slice(i, end);
    const items: PMNode[] = [];
    let itemStart = 0;
    for (let j = 1; j <= run.length; j++) {
      if (j < run.length && !run[j]!.list[depth]!.startsItem) continue;
      const itemLeaves = run.slice(itemStart, j);
      items.push(schema.nodes.listItem!.create(
        itemLeaves[0]!.list[depth]!.item,
        buildLists(itemLeaves, schema, depth + 1),
      ));
      itemStart = j;
    }
    out.push(schema.nodes[level.type]!.create(level.attrs, items));
    i = end;
  }
  return out;
}

/** The top-level range covering every list a block in `from`..`to` sits in. */
export function topLevelRange(doc: PMNode, from: number, to: number) {
  let start = from;
  let end = to;
  doc.forEach((child, offset) => {
    const childEnd = offset + child.nodeSize;
    if (childEnd > from && offset < to) {
      start = Math.min(start, offset);
      end = Math.max(end, childEnd);
    }
  });
  return { from: start, to: end };
}
