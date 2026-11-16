import type { Node } from "prosemirror-model";
import type { Mappable } from "prosemirror-transform";
import type { PagePoint } from "../layout/pagePoint";

/**
 * Marks a popover's root. Focus moving into one does not blur the editor away
 * from it, and the pointer crossing onto one keeps the hover stack it serves.
 * `getPopoverElement` is the primary check; this attribute is for vanilla and
 * third-party popovers without their own root accessor.
 *
 * Convention: set it to the popover's name (`bubble-menu`, `link-popover`).
 * Presence is checked, not value; the value only documents the DOM.
 */
export const POPOVER_MARKER = "data-scrivr-popover";

/** Whether `element` is inside a popover. */
export function inPopover(element: Element | null): boolean {
  return element?.closest(`[${POPOVER_MARKER}]`) != null;
}

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
  /**
   * The position under the pointer, inside `[pos, end)`: the character for a
   * mark, the object or the point's position for a node. A popover anchors to
   * the part of a target the pointer is on — the hovered line of a wrapped link.
   */
  at: number;
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
  /**
   * True when an edit, not the pointer, changed the stack: targets moved with
   * the text, or one was deleted. A deleted target is gone, not left behind,
   * so a popover showing it should close without a grace period.
   */
  fromEdit?: boolean;
  /**
   * True when the reader ended hover by keyboard — typing or Escape. The peek
   * closes at once, even under the pointer.
   */
  dismissed?: boolean;
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

/**
 * Same stack, layer for layer — the only change that is worth an event. Where
 * in a target the pointer rests (`at`) is not a change: moving along a link
 * is still hovering it.
 */
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

/** A document range, `[from, to)`. */
export interface DocRange {
  from: number;
  to: number;
}

/**
 * A range carried through an edit. Its start sticks after an insertion there
 * and its end before one, so it neither grows onto its neighbours nor slides
 * off what it held. It is gone only once the edit leaves it empty: an edit
 * that replaced what it held in place — a node whose attrs changed, a retyped
 * character — keeps it, because what is in the range is re-read, never kept.
 */
export function mapRange(range: DocRange, mapping: Mappable): DocRange | null {
  const from = mapping.map(range.from, 1);
  const to = mapping.map(range.to, -1);
  return to > from ? { from, to } : null;
}

/** A hover target carried through an edit by `mapRange`, `at` kept inside it. */
export function mapHoverTarget(target: HoverTarget, mapping: Mappable): HoverTarget | null {
  const range = mapRange({ from: target.pos, to: target.end }, mapping);
  if (!range) return null;
  const at = Math.min(Math.max(mapping.map(target.at, 1), range.from), range.to - 1);
  return { ...target, pos: range.from, end: range.to, at };
}
