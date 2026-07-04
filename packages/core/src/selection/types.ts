import type { EditorState, Selection } from "prosemirror-state";
import type { PageConfig } from "../layout/PageLayout";
import type { CharacterMap, ObjectRectEntry } from "../layout/CharacterMap";
import type { ResolvedTheme } from "../model/theme";
import type { IEditor } from "../extensions/types";

/**
 * The selection system. Every active selection is a ProseMirror `Selection`
 * (the single source of truth in `state.selection`); a `SelectionBehavior`
 * translates it into three view-facing shapes:
 *
 *   - a `SelectionDescriptor` (what the UI may offer),
 *   - `SelectionPrimitive[]` (what the canvas paints),
 *   - a `SelectionGesture` (how a drag on it commits).
 *
 * Behaviors are registered by extensions, so tables, images, and Seraa's custom
 * nodes each own their selection without the renderer or pointer controller
 * knowing what they are.
 */

// ── Geometry primitives ──────────────────────────────────────────────────────
// The complete vocabulary the renderer needs to paint any selection. TileManager
// paints these; it never learns what a table, image, or custom node is.

/** A rectangle in page-local logical pixels. */
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

export type SelectionPrimitive =
  | { type: "caret"; x: number; y: number; height: number; color: string }
  | { type: "fill"; rects: SelectionRect[]; color: string }
  | { type: "outline"; rect: SelectionRect; color: string; width: number }
  | { type: "handles"; handles: SelectionHandle[]; color: string };

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
 * SelectionSnapshot so consumers branch on `kind`/`capabilities` instead of
 * `instanceof`.
 */
export interface SelectionDescriptor {
  /** Owning behavior kind, e.g. "text", "node", "cell". */
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
 * cursor, not where in pixels. Behaviors turn a target into a gesture.
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
 * A drag in progress, owned by the behavior that began it. Transient by
 * design — it lives on the pointer controller, never in editor state; only the
 * committed selection belongs to ProseMirror.
 */
export interface SelectionGesture {
  /** Advance for a pointer move; `hit` is the target now under the cursor. */
  move(event: PointerEvent, hit: HitTarget | null): void;
  /** Commit on pointerup. */
  end(event: PointerEvent): void;
  /** Abort on pointercancel; leaves no selection change. */
  cancel(): void;
}

// ── Behavior + contexts ──────────────────────────────────────────────────────

export interface SelectionDescribeContext {
  state: EditorState;
  surfaceId: string;
}

export interface SelectionGeometryContext {
  page: number;
  pageConfig: PageConfig;
  theme: ResolvedTheme;
  charMap: CharacterMap;
  /** Painted rect for an object at docPos — reads current layout, no re-layout. */
  nodeRectAt(docPos: number): ObjectRectEntry | undefined;
}

/**
 * One selection kind's behavior. The registry picks the first behavior whose
 * `matches` is true (a default fallback matches anything, so custom selections
 * are never left un-describable / un-paintable).
 */
export interface SelectionBehavior<S extends Selection = Selection> {
  kind: string;
  matches(selection: Selection): selection is S;
  describe(selection: S, ctx: SelectionDescribeContext): SelectionDescriptor;
  /** Primitives to paint for `page`; called once per visible page during paint. */
  geometry(selection: S, ctx: SelectionGeometryContext): SelectionPrimitive[];
  /** Begin a drag on this selection, or null to decline (transient gesture). */
  beginGesture?(hit: HitTarget, event: PointerEvent, editor: IEditor): SelectionGesture | null;
}
