/**
 * Ingestion-time sweep for placeholder nodes left behind by an operation that
 * never finished.
 *
 * Pasting an image reserves a node carrying `pendingPasteId` so something
 * appears at the caret immediately, then resolves it in place once the bytes
 * are read or uploaded. `PasteTransformer.cancel()` clears the reservation on
 * unmount, on going read-only, and on a failed resolve — but a closed tab or a
 * crash runs none of those, so a document can be persisted with the placeholder
 * still in it. Nothing will ever resolve it: the promise that owned it died
 * with the page.
 *
 * A document being *loaded* has no upload in flight by definition, which is
 * what makes this safe to do unconditionally at ingestion and nowhere else. Any
 * reservation present at load time is orphaned.
 *
 * Returns the same node reference when nothing was dropped, so callers can use
 * identity to detect a no-op.
 */
import { Fragment } from "prosemirror-model";
import type { Node } from "prosemirror-model";

/** Attr whose presence marks a node as reserved by an unfinished paste. */
const PENDING_ATTR = "pendingPasteId";

export interface DropPendingResult {
  doc: Node;
  /** How many placeholder nodes were removed. */
  dropped: number;
}

export function dropPendingPlaceholders(doc: Node): DropPendingResult {
  let dropped = 0;

  const walk = (node: Node): Node | null => {
    if (isPending(node)) {
      dropped++;
      return null;
    }
    // Text nodes carry marks, never children.
    if (node.isText) return node;

    let changed = false;
    const kept: Node[] = [];
    node.forEach((child) => {
      const walked = walk(child);
      if (walked === null) {
        changed = true;
      } else {
        if (walked !== child) changed = true;
        kept.push(walked);
      }
    });

    return changed ? node.copy(Fragment.fromArray(kept)) : node;
  };

  // The root is never itself a placeholder, so walk() cannot drop it.
  const walked = walk(doc);
  return { doc: walked ?? doc, dropped };
}

function isPending(node: Node): boolean {
  return typeof node.attrs[PENDING_ATTR] === "string";
}
