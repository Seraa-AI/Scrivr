import type { Node, Step, Transaction } from "@scrivr/core/pm";
import { stepRange } from "./transactionProcessing";

/** Ranges in the document *after* a step, including writes with empty maps. */
function rewrittenRanges(step: Step, after: Node) {
  const ranges: Array<{ from: number; to: number }> = [];
  step.getMap().forEach((_from, _to, from, to) => ranges.push({ from, to }));
  if (ranges.length) return ranges;
  const range = stepRange(step);
  if (!range) return ranges;
  // Attribute and node-mark steps address one node rather than a text span.
  // Their empty map does not describe the node whose markup must be checked.
  if (range.from === range.to) {
    const node = after.nodeAt(range.from);
    if (node) range.to += node.nodeSize;
  }
  return [range];
}

function checkContent(node: Node) {
  if (!node.type.validContent(node.content)) {
    throw new RangeError(`Invalid content for node ${node.type.name}`);
  }
}

/**
 * Validate the result at the review's write boundary. Content replacements use
 * their new ranges; marks and attributes supply explicit ranges because their
 * maps are empty. Only later steps map those ranges into the final document.
 *
 * Partially covered containers are checked for their immediate content rules,
 * without recursively validating unrelated siblings. Fully rewritten nodes
 * receive the full schema check. A deletion's empty range checks its containing
 * path, not the untouched nodes that now happen to sit beside it.
 */
export function checkReviewTransaction(tr: Transaction): void {
  const doc = tr.doc;
  checkContent(doc);
  tr.steps.forEach((step, i) => {
    const after = tr.docs[i + 1] ?? doc;
    const forward = tr.mapping.slice(i + 1);
    for (const range of rewrittenRanges(step, after)) {
      const from = forward.map(range.from, -1);
      const to = Math.max(from, forward.map(range.to, 1));
      for (const pos of [from, to]) {
        const resolved = doc.resolve(pos);
        for (let depth = 1; depth <= resolved.depth; depth++) checkContent(resolved.node(depth));
      }
      if (from === to) continue;
      doc.nodesBetween(from, to, (node, pos) => {
        if (node.isLeaf || (from <= pos && pos + node.nodeSize <= to)) {
          node.check();
          return false;
        }
        checkContent(node);
        return true;
      });
    }
  });
}
