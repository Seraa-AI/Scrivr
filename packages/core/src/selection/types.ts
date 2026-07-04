import type { EditorState, Selection } from "prosemirror-state";
import type { Schema } from "prosemirror-model";
import type { DocumentLayout } from "../layout/PageLayout";
import type { CharacterMap, ObjectRectEntry } from "../layout/CharacterMap";
import type { IEditor } from "../extensions/types";

/**
 * The selection system separates four concerns so one selection can be text, an
 * image, a table range, or a Seraa custom node without the renderer or pointer
 * controller knowing which:
 *
 *   Selection   = durable logical state (a ProseMirror `Selection`; doc coords)
 *   Descriptor  = semantic public representation (what the UI may offer)
 *   Geometry    = visual representation (paintable primitives)
 *   Gesture     = transient pointer interaction (never in editor state)
 *
 * A `SelectionBehavior` interprets one selection kind into a descriptor and
 * geometry. Pointer gestures live in a separate provider, so selections with no
 * pointer interaction (keyboard, programmatic, collab, select-all) need not
 * implement one. Behaviors are registered by extensions.
 */

// ── Geometry primitives ──────────────────────────────────────────────────────
// The complete vocabulary the renderer needs to paint any selection. Behaviors
// stay theme-agnostic: a primitive names a semantic `role`, and the renderer
// maps role → theme color.

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A resize grip: a point plus the CSS cursor to show over it. */
export interface SelectionHandle {
  x: number;
  y: number;
  cursor: string;
}

/** Which theme color a primitive paints in. */
export type SelectionRole = "selection" | "caret" | "affordance";

export type SelectionPrimitive =
  | { type: "caret"; x: number; y: number; height: number }
  | { type: "fill"; rects: SelectionRect[]; role?: SelectionRole }
  | { type: "outline"; rect: SelectionRect; width: number; role?: SelectionRole }
  | { type: "handles"; handles: SelectionHandle[]; role?: SelectionRole };

// ── Descriptor + capabilities ────────────────────────────────────────────────

/** What the UI (menus, toolbars, clipboard) may do with the current selection. */
export interface SelectionCapabilities {
  copy: boolean;
  cut: boolean;
  delete: boolean;
  /** Text-formatting marks (bold, color, …) can apply. */
  formatText: boolean;
  /** The selection's target can be dragged to a new position. */
  drag: boolean;
  /** The selection's target can be resized (e.g. an image). */
  resize: boolean;
}

/**
 * The public, kind-tagged view of `state.selection`. Replaces the text-only
 * SelectionSnapshot so consumers branch on `kind`/`capabilities` and never
 * touch ProseMirror classes, table maps, or resolved positions. Specific kinds
 * extend this with their own semantic fields (e.g. a cell descriptor adds row/
 * column bounds and a `selectedCellCount`).
 */
export interface SelectionDescriptor {
  /** Owning behavior kind, e.g. "text", "node", "table-cell". */
  kind: string;
  /** Surface the selection lives in ("body", or a header/footer surface id). */
  surfaceId: string;
  empty: boolean;
  capabilities: SelectionCapabilities;
  /**
   * Raw PM offsets. For a text range these are real caret positions; for a
   * structural selection (node, cell) they are boundary positions — read
   * `kind`/`capabilities`, never assume these describe a text range.
   */
  anchor: number;
  head: number;
  from: number;
  to: number;
}

// ── Hit testing + gesture ────────────────────────────────────────────────────

/**
 * The semantic result of hit-testing a pointer position — what was under the
 * cursor, not where in pixels. A gesture provider turns a target into a gesture.
 */
export interface HitTarget {
  /** e.g. "text", "node", "table-cell", or a custom kind. */
  kind: string;
  page: number;
  /** Doc position most relevant to the hit (caret pos, node pos, cell pos). */
  pos: number;
  /** Behavior-specific data (resize-handle id, node type, …). */
  payload?: unknown;
}

/**
 * A drag in progress, owned by the provider that began it. Transient by
 * design — it lives on the pointer controller, never in editor state; only the
 * committed selection belongs to ProseMirror.
 */
export interface SelectionGesture {
  /** Advance for a pointer move; `hit` is the target now under the cursor. */
  update(hit: HitTarget | null, event: PointerEvent): void;
  /** Commit on pointerup. */
  finish(hit: HitTarget | null, event: PointerEvent): void;
  /** Abort on pointercancel; leaves no selection change. */
  cancel(): void;
}

export interface GestureContext {
  editor: IEditor;
}

/**
 * Begins pointer gestures for a selection kind. Kept separate from
 * `SelectionBehavior` so non-pointer selections need not implement it.
 */
export interface SelectionGestureProvider {
  beginGesture(hit: HitTarget, event: PointerEvent, ctx: GestureContext): SelectionGesture | null;
}

// ── Behavior + contexts ──────────────────────────────────────────────────────

export interface SelectionDescribeContext {
  state: EditorState;
  surfaceId: string;
  schema: Schema;
  readOnly: boolean;
}

export interface SelectionGeometryContext {
  state: EditorState;
  layout: DocumentLayout;
  charMap: CharacterMap;
  /** 1-based page being painted. */
  page: number;
  /** Painted rect for an object at docPos from the current layout (no re-layout). */
  nodeRectAt(docPos: number): ObjectRectEntry | undefined;
}

/**
 * One selection kind's interpretation: how it is described and painted. Both
 * methods are pure reads (`selection + state (+ layout) → value`); they never
 * dispatch or mutate. The registry picks the first behavior whose `matches` is
 * true (a default fallback matches anything, so a custom selection is never left
 * un-describable / un-paintable).
 */
export interface SelectionBehavior<S extends Selection = Selection> {
  kind: string;
  matches(selection: Selection): selection is S;
  describe(selection: S, ctx: SelectionDescribeContext): SelectionDescriptor;
  /** Primitives to paint for `ctx.page`; called once per visible page. */
  geometry(selection: S, ctx: SelectionGeometryContext): SelectionPrimitive[];
}
