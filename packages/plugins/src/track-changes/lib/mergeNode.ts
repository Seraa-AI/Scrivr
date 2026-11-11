import { Fragment, Node as PMNode } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { canJoin } from "@scrivr/core/pm";

/** Deletes node but tries to preserve content by joining or replacing with empty. */
export function mergeNode(node: PMNode, pos: number, tr: Transaction) {
  // A leaf has no content to keep, and joining it would erase it into its neighbour.
  if (node.isLeaf) return undefined;
  if (canJoin(tr.doc, pos)) {
    return tr.join(pos);
  } else if (!tr.doc.resolve(pos).nodeBefore) {
    return undefined;
  }
  const resPos = tr.doc.resolve(pos);
  const canMergeToNodeAbove =
    (resPos.parent !== tr.doc || resPos.nodeBefore) && node.firstChild?.isText;
  if (canMergeToNodeAbove) {
    // `pos` is already in the current document; mapping it again would shift it
    // by steps applied before it was resolved.
    return tr.replaceWith(pos, pos + node.nodeSize, Fragment.empty);
  }
  return undefined;
}
