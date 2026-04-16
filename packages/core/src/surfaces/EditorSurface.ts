/**
 * EditorSurface — an independent edit region owned by a plugin. Holds its own
 * `EditorState` and `CharacterMap`; the body/flow document is NOT a surface.
 * Plugins instantiate these, register with `SurfaceRegistry`, and dispatch
 * transactions against them while their surface is active.
 *
 * Rendering integration is deferred to the plugin that owns the surface — the
 * `charMap` ships empty and is populated by the plugin's paint hook. Dispatch
 * clears the charMap whenever content changes; activation does not touch it.
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

export class EditorSurface {
  readonly id: SurfaceId;
  readonly owner: string;
  readonly schema: Schema;
  readonly charMap: CharacterMap;

  private _state: EditorState;
  private _isDirty = false;
  private readonly _listeners = new Set<() => void>();

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
   * charMap (stale glyph positions), and notifies listeners synchronously.
   * Throws if called while the surface is committing (prevents commit loops).
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
    if (tr.docChanged) {
      this._isDirty = true;
      this.charMap.clear();
    }
    this._listeners.forEach((h) => h());
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
   * Subscribe to post-dispatch notifications. Returns an unsubscribe thunk.
   * Listeners fire synchronously inside `dispatch`; uncaught exceptions
   * propagate (match `BaseEditor._notifyListeners` precedent).
   */
  onUpdate(handler: () => void): Unsubscribe {
    this._listeners.add(handler);
    return () => {
      this._listeners.delete(handler);
    };
  }
}
