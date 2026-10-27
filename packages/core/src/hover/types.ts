import type { Mark, Node } from "prosemirror-model";
import type { PagePoint } from "../layout/pagePoint";

/**
 * One layer of what is under the pointer. See docs/hover-popovers-rfc.md §1.
 *
 * Positions go stale on the next transaction, so a target never carries a live
 * `Node`; consumers re-resolve `pos` against current state.
 */
export interface HoverTarget {
  /**
   * Semantic kind. Uses the SelectionDescriptor.kind vocabulary where one
   * exists ("image", "table-cell") so popovers key hover and selection off the
   * same identity. Marks use their mark name ("link").
   */
  kind: string;
  /** Surface that owns `pos` — "body" or a chrome surface id. */
  surfaceId: string;
  /** Node position, or mark range start. */
  pos: number;
  /** Mark range end, or pos + node.nodeSize. */
  end: number;
  /** Kind-specific metadata from the resolver that produced the target. */
  payload?: unknown;
}

export interface HoverEvent {
  /** Innermost first: [link, table-cell, table]. Empty when over nothing. */
  targets: readonly HoverTarget[];
  /** Null when the pointer left the editor. */
  point: PagePoint | null;
}

/** Mark-level hover: links today, comments / tracked changes later. */
export interface MarkHoverResolver {
  mark: string;
  /** Payload for the target; return null to decline this instance. */
  resolve(mark: Mark, range: { from: number; to: number }): unknown | null;
}

/**
 * Node-level hover for structure the pointer is inside of — table cells and
 * tables. Matched against the ancestors of the point's document position.
 */
export interface NodeHoverResolver {
  /** Node type name to match. */
  node: string;
  /** Target kind to report. */
  kind: string;
  /** Payload for the target; return null to decline this instance. */
  resolve(node: Node, pos: number): unknown | null;
}

export type HoverResolver = MarkHoverResolver | NodeHoverResolver;

export function isMarkHoverResolver(r: HoverResolver): r is MarkHoverResolver {
  return "mark" in r;
}

/** Same stack, layer for layer — the only change that is worth an event. */
export function sameHoverTargets(
  a: readonly HoverTarget[],
  b: readonly HoverTarget[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => {
    const u = b[i]!;
    return t.kind === u.kind && t.surfaceId === u.surfaceId && t.pos === u.pos && t.end === u.end;
  });
}
