import type { Node } from "prosemirror-model";
import type { PagePoint } from "../layout/pagePoint";

/**
 * One layer of what is under the pointer.
 *
 * The editor maps `pos` and `end` through each transaction while the pointer
 * rests, but a target never carries a live `Node`: what is at `pos` can change
 * without the range moving, so consumers re-resolve it against current state.
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
}

export interface HoverEvent {
  /** Innermost first: [link, table-cell, table]. Empty when over nothing. */
  targets: readonly HoverTarget[];
  /**
   * The point the targets were resolved at. Null when hover was cleared rather
   * than resolved — the pointer left, a key or press ended hover, or a drag
   * began.
   */
  point: PagePoint | null;
}

/** Mark-level hover: links today, comments / tracked changes later. */
export interface MarkHoverResolver {
  mark: string;
  /**
   * The range the mark covers around the character at `pos` (the character's
   * own position), or null to decline. The extension answers because only it
   * knows when two adjacent runs are one instance — a link runs as far as its
   * href does.
   */
  range(doc: Node, pos: number): { from: number; to: number } | null;
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
