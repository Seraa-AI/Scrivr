import type { Node as PmNode } from "@scrivr/core/pm";
import { alignInOrder } from "./align";

/**
 * How a document changed on its way out to DOCX and back.
 *
 * Import assigns fresh block ids, so `nodeId` is left out. Everything else —
 * node types, text, marks and attributes — should come back as it went out;
 * a difference is a bug in one direction or the other.
 *
 * Blocks are paired in order by their full content, so one block that changed
 * does not shift every pair after it. A block with no partner is reported by
 * its type and opening text, which stays stable while unrelated blocks move.
 * Two blocks can share a label, so a list of differences can repeat one.
 */
export function roundTripDifferences(before: PmNode, after: PmNode): string[] {
  const a = blocksOf(before);
  const b = blocksOf(after);
  const end: [number, number] = [a.length, b.length];
  const diffs: string[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...alignInOrder(a, b, (block) => block.json), end]) {
    const removed = a.slice(i, pi);
    const added = b.slice(j, pj);
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      const r = removed[k];
      const n = added[k];
      if (r && n && r.label === n.label) diffs.push(`changed: ${r.label}`);
      else {
        if (r) diffs.push(`lost: ${r.label}`);
        if (n) diffs.push(`gained: ${n.label}`);
      }
    }
    i = pi + 1;
    j = pj + 1;
  }
  return diffs;
}

interface Block {
  json: string;
  label: string;
}

function blocksOf(doc: PmNode): Block[] {
  const out: Block[] = [];
  doc.forEach((node) => {
    out.push({
      json: JSON.stringify(withoutIds(node.toJSON())),
      label: `${node.type.name} "${node.textContent.replace(/\s+/g, " ").trim().slice(0, 32)}"`,
    });
  });
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
