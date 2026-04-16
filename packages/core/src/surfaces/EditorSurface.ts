/**
 * EditorSurface — an independent edit region owned by a plugin. Holds its own
 * `EditorState` and `CharacterMap`; the body/flow document is NOT a surface.
 * Plugins instantiate these, register with `SurfaceRegistry`, and dispatch
 * transactions against them while their surface is active.
 *
 * Rendering integration is deferred to the plugin that owns the surface — the
 * `charMap` ships empty and is populated by the plugin's paint hook. Dispatch
 * clears the charMap whenever content changes; activation does not touch it.
 *
 * **Sharp edge**: activating a surface before its charMap is populated means
 * click-to-cursor and keyboard navigation will hit an empty glyph index and
 * silently resolve to position 0. Plugins MUST populate the charMap (via the
 * same layout/render pipeline the body uses) before making their surface
 * usable for editing. There is no runtime guard today — see PR 7 roadmap for
 * a surface-aware viewport lookup.
 */

import { Node, type Schema } from "prosemirror-model";
import { EditorState, type Transaction } from "prosemirror-state";
import { CharacterMap } from "../layout/CharacterMap";
import type { SurfaceId, Unsubscribe } from "./types";

export interface EditorSurfaceInit {
  id: SurfaceId;
  /** Owning plugin namespace — must match an extension's `addSurfaceOwner().owner`. */
  owner: string;
  schema: Schema;
  /** PM JSON form of the initial document (e.g. from flow `doc.attrs.header`). */
  initialDocJSON: Record<string, unknown>;
}

/**
 * Event delivered to `onUpdate` listeners after each dispatch. Carries enough
 * to decide downstream work (re-paint vs re-measure) without re-reading state.
 */
export interface SurfaceUpdate {
  /** Post-dispatch state — identical to `surface.state`. */
  state: EditorState;
  /** The transaction that was applied. */
  tr: Transaction;
  /** True iff the doc changed. Selection-only trs have this false. */
  docChanged: boolean;
}

export class EditorSurface {
  readonly id: SurfaceId;
  readonly owner: string;
  readonly schema: Schema;
  readonly charMap: CharacterMap;

  private _state: EditorState;
  private _isDirty = false;
  private readonly _listeners = new Set<(update: SurfaceUpdate) => void>();

  /**
   * @internal
   * Set by SurfaceRegistry during `onCommit()`. While true, `dispatch()`
   * throws — turns silent commit recursion into a loud error.
   */
  _committing = false;

  constructor(init: EditorSurfaceInit) {
    this.id = init.id;
    this.owner = init.owner;
    this.schema = init.schema;
    this.charMap = new CharacterMap();

    const doc = Node.fromJSON(init.schema, init.initialDocJSON);
    this._state = EditorState.create({ schema: init.schema, doc });
  }

  /** Current state. Always reflects the most recent dispatch. */
  get state(): EditorState {
    return this._state;
  }

  /**
   * True iff any `docChanged` transaction has been dispatched since the last
   * `markClean()`. Selection-only transactions do not flip this. Owners call
   * `markClean()` after persisting via `onCommit()`.
   */
  get isDirty(): boolean {
    return this._isDirty;
  }

  /**
   * Apply a transaction. Flips `isDirty` if the doc changed, clears the
   * charMap (stale glyph positions), and notifies listeners synchronously
   * with the full `SurfaceUpdate` so they can cheaply distinguish
   * selection-only from content changes.
   *
   * Dispatching during lifecycle callbacks:
   *   - onActivate / onDeactivate: allowed. The surface is a valid target
   *     in those contexts (onActivate runs after _activeId flips; onDeactivate
   *     runs against a surface that is simply leaving active). Listeners
   *     fire as usual.
   *   - onCommit: **forbidden**. Owners dispatch against the flow doc during
   *     commit (persisting via DocAttrStep) — dispatching against the surface
   *     would re-dirty it and spin the commit loop. This is guarded by
   *     `_committing` and throws a clear error.
   */
  dispatch(tr: Transaction): void {
    if (this._committing) {
      throw new Error(
        `[EditorSurface] dispatch() called on "${this.id}" during its own ` +
        `onCommit() — owners must dispatch against the flow document, not ` +
        `the surface they are committing.`,
      );
    }
    this._state = this._state.apply(tr);
    const docChanged = tr.docChanged;
    if (docChanged) {
      this._isDirty = true;
      this.charMap.clear();
    }
    const update: SurfaceUpdate = { state: this._state, tr, docChanged };
    this._listeners.forEach((h) => h(update));
  }

  /** Clear the dirty flag. Owners call this after a successful commit. */
  markClean(): void {
    this._isDirty = false;
  }

  /** Serialize current doc to PM JSON for persistence. */
  toDocJSON(): Record<string, unknown> {
    return this._state.doc.toJSON() as Record<string, unknown>;
  }

  /**
   * Subscribe to post-dispatch notifications. Handler receives a
   * `SurfaceUpdate` so consumers can branch on `docChanged` without
   * re-reading state. Returns an unsubscribe thunk. Listeners fire
   * synchronously inside `dispatch`; uncaught exceptions propagate.
   */
  onUpdate(handler: (update: SurfaceUpdate) => void): Unsubscribe {
    this._listeners.add(handler);
    return () => {
      this._listeners.delete(handler);
    };
  }
}
