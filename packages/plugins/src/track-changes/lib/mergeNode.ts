import { Fragment, Node as PMNode } from "@scrivr/core/pm";
import { Transaction } from "@scrivr/core/pm";
import { canJoin } from "@scrivr/core/pm";

/** Deletes node but tries to preserve content by joining or replacing with empty. */
export function mergeNode(node: PMNode, pos: number, tr: Transaction) {
  if (canJoin(tr.doc, pos)) {
    return tr.join(pos);
  } else if (!tr.doc.resolve(pos).nodeBefore) {
    return undefined;
  }
  const resPos = tr.doc.resolve(pos);
  const canMergeToNodeAbove =
    (resPos.parent !== tr.doc || resPos.nodeBefore) && node.firstChild?.isText;
  if (canMergeToNodeAbove) {
    return tr.replaceWith(
      tr.mapping.map(pos),
      tr.mapping.map(pos + node.nodeSize),
      Fragment.empty,
    );
  }
  return undefined;
}
