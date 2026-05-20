import type { Node, Mark } from "prosemirror-model";
import type { NodeAttrsFor, MarkAttrsFor } from "../types/augmentation";

/**
 * Typed accessor for a ProseMirror node's attrs.
 *
 * Returns the shape declared in `NodeAttributes[K]` (via module augmentation
 * — see `types/augmentation.ts`). The single `as` lives here, behind a
 * runtime `node.type.name === kind` guard, so extension call sites get
 * fully-typed `attrs.src` / `attrs.width` access without each one
 * sprinkling its own `as { src: string; ... }` cast.
 *
 * Throws when called with the wrong kind — that's an extension bug, not
 * a runtime user-input problem. Catch at integration time.
 *
 * @example
 *   declare module "@scrivr/core" {
 *     interface NodeAttributes {
 *       image: { src: string; alt: string; width: number; height: number };
 *     }
 *   }
 *
 *   toDOM(node) {
 *     const { src, alt, width, height } = getNodeAttrs(node, "image");
 *     return ["img", { src, alt, width: String(width), height: String(height) }];
 *   }
 */
export function getNodeAttrs<K extends string>(
  node: Node,
  kind: K,
): NodeAttrsFor<K> {
  if (node.type.name !== kind) {
    throw new Error(
      `[getNodeAttrs] Expected node of type "${kind}", got "${node.type.name}". ` +
        `This is an extension wiring bug — the caller passed a node from the wrong NodeType.`,
    );
  }
  return node.attrs as NodeAttrsFor<K>;
}

/**
 * Typed accessor for a ProseMirror mark's attrs. Same shape as
 * `getNodeAttrs` but for marks — augment `MarkAttributes[K]` in the
 * extension and access through this helper at every call site.
 */
export function getMarkAttrs<K extends string>(
  mark: Mark,
  kind: K,
): MarkAttrsFor<K> {
  if (mark.type.name !== kind) {
    throw new Error(
      `[getMarkAttrs] Expected mark of type "${kind}", got "${mark.type.name}". ` +
        `This is an extension wiring bug — the caller passed a mark from the wrong MarkType.`,
    );
  }
  return mark.attrs as MarkAttrsFor<K>;
}
