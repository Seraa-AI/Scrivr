import type { Node as PmNode } from "prosemirror-model";

/**
 * A top-level body block paired with its document-order index. The index is the
 * substrate for the deterministic positional fallback id.
 */
export interface BlockEntry {
  node: PmNode;
  index: number;
}

/**
 * Resolve a block's stable id. Uses the block's `nodeId` attr when present;
 * otherwise a deterministic positional path `"p:" + index`.
 *
 * Positional ids are stable for a given tree shape but NOT across edits — they
 * keep the emitter running before server-side id assignment, at the cost of
 * disabling incremental re-embed. No timestamps / randomness: same tree ⇒ same id.
 */
export function resolveNodeId(entry: BlockEntry): string {
  const raw = entry.node.attrs["nodeId"];
  if (typeof raw === "string" && raw.length > 0) return raw;
  return `p:${entry.index}`;
}
