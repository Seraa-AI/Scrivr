import type { Node as PmNode } from "@scrivr/core/pm";
import { alignInOrder } from "./align";

/**
 * How a document changed on its way out to DOCX and back.
 *
 * Import assigns fresh block ids, so `nodeId` is left out. Everything else —
 * node types, text, marks and attributes — should come back as it went out;
 * a difference is a bug in one direction or the other.
 *
 * Compared block by block at the leaves — each paragraph, heading or other
 * text block, and each block with no content such as an image — so a loss in
 * one list item or table cell is its own difference, not hidden in a list or
 * table already known to differ. Each leaf carries the types and attributes
 * of the blocks it sits in, so a change to its list or cell shows on it; and
 * each list, table or other container is also an entry of its own, by its
 * attributes and how many children it holds, so one split in two shows.
 *
 * Leaves are paired in order by their full content, so one that changed does
 * not shift every pair after it. One with no partner is reported by its path
 * and opening text, which stays stable while unrelated blocks move. Two
 * leaves can share a label, so a list of differences can repeat one.
 */
export function roundTripDifferences(before: PmNode, after: PmNode): string[] {
  const a = blocksOf(before);
  const b = blocksOf(after);
  // The pair past both ends flushes whatever follows the last matched pair.
  const pastTheEnd: [number, number] = [a.length, b.length];
  const diffs: string[] = [];
  let i = 0;
  let j = 0;
  for (const [pairedBefore, pairedAfter] of [...alignInOrder(a, b, (block) => block.json), pastTheEnd]) {
    const removed = a.slice(i, pairedBefore);
    const added = b.slice(j, pairedAfter);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const lostBlock = removed[k];
      const gainedBlock = added[k];
      if (lostBlock && gainedBlock && lostBlock.label === gainedBlock.label) diffs.push(`changed: ${lostBlock.label}`);
      else {
        if (lostBlock) diffs.push(`lost: ${lostBlock.label}`);
        if (gainedBlock) diffs.push(`gained: ${gainedBlock.label}`);
      }
    }
    i = pairedBefore + 1;
    j = pairedAfter + 1;
  }
  return diffs;
}

interface Block {
  json: string;
  label: string;
}

function blocksOf(doc: PmNode): Block[] {
  const out: Block[] = [];
  const walk = (node: PmNode, ancestors: readonly PmNode[]): void => {
    const path = [...ancestors, node].map((n) => n.type.name).join(" > ");
    const opening = `"${node.textContent.replace(/\s+/g, " ").trim().slice(0, 32)}"`;
    if (node.isTextblock || (node.isBlock && node.childCount === 0)) {
      out.push({
        json: JSON.stringify([...ancestors.map((n) => [n.type.name, withoutIds(n.attrs)]), withoutIds(node.toJSON())]),
        label: `${path} ${opening}`,
      });
      return;
    }
    out.push({
      json: JSON.stringify([path, withoutIds(node.attrs), node.childCount]),
      label: `${path} of ${node.childCount} ${opening}`,
    });
    node.forEach((child) => walk(child, [...ancestors, node]));
  };
  doc.forEach((node) => walk(node, []));
  return out;
}

function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutIds);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "nodeId")
      .map(([key, v]) => [key, withoutIds(v)]),
  );
}
