/**
 * SurfaceRegistry — tracks all active EditorSurfaces and the current activation.
 *
 * The registry is deliberately pure: it has no coupling to ExtensionManager,
 * Editor, or any layout/render system. Editor injects an owner mediator via
 * `_setOwnerMediator()` that the registry calls during activation transitions.
 * This keeps the registry unit-testable without an Editor instance.
 *
 * Activation lifecycle (inside `activate(nextId)`):
 *   1. If nextId === _activeId: no-op.
 *   2. If prev !== null and prev.isDirty: mediator.commit(prev).
 *      - Throws abort the activation (state unchanged). Owners use this to
 *        signal persistence failures that should not be silently dropped.
 *   3. If prev !== null: mediator.deactivate(prev).
 *      - Throws are logged and swallowed — the activation continues.
 *   4. Flip _activeId = nextId.
 *   5. If nextId !== null: mediator.activate(next).
 *      - Throws are logged and swallowed.
 *   6. Fire onSurfaceChange(prevId, nextId) listeners synchronously.
 *
 * ## Flow-is-identity invariant (load-bearing)
 *
 * `editor.state` always refers to the flow document, never an active
 * surface. This registry changes input routing; document identity (commands,
 * external transactions like Y.js, subscribers that diff `editor.state.doc`)
 * continues to target flow regardless of activation. If this ever breaks,
 * save hooks silently target the wrong state — the exact class of bug the
 * registry exists to prevent. Enforced by integration tests that assert
 * `editor.getState()` remains flow-bound while a surface is active.
 *
 * ## Lazy-surface pattern (for plugin authors)
 *
 * Plugins typically maintain their own `Map<LogicalId, EditorSurface>` cache
 * so surfaces are created on demand and persist across deactivations:
 *
 *   1. On first user intent to edit (e.g. double-click on a header region),
 *      look up the surface by logical id; if missing, `new EditorSurface(...)`
 *      + `registry.register(surface)`.
 *   2. Call `registry.activate(surface.id)`.
 *   3. On deactivation, LEAVE the surface registered — re-activation is then
 *      free. Unregister only on editor destroy or surface deletion.
 *
 * This avoids allocating N surfaces for N potential edit regions at document
 * load time (important for documents with hundreds of footnotes or comments).
 *
 * ## Debugging
 *
 * Set `globalThis.__SURFACE_DEBUG__ = true` to log every activation
 * transition (prev, next, owner, dirty state). Matches the `__LAYOUT_DEBUG__`
 * convention used by the layout engine.
 */

import type { EditorSurface } from "./EditorSurface";
import type { SurfaceId, Unsubscribe } from "./types";

type SurfaceChangeHandler = (
  prev: SurfaceId | null,
  next: SurfaceId | null,
) => void;

/**
 * @internal
 * Owner callbacks the Editor installs. Each method is invoked with the
 * relevant surface. `commit` throwing aborts activation; the others log.
 */
export interface SurfaceOwnerMediator {
  commit: (surface: EditorSurface) => void;
  deactivate: (surface: EditorSurface) => void;
  activate: (surface: EditorSurface) => void;
}

const noopMediator: SurfaceOwnerMediator = {
  commit: () => {},
  deactivate: () => {},
  activate: () => {},
};

export class SurfaceRegistry {
  private readonly _surfaces = new Map<SurfaceId, EditorSurface>();
  private _activeId: SurfaceId | null = null;
  private readonly _changeListeners = new Set<SurfaceChangeHandler>();
  private _mediator: SurfaceOwnerMediator = noopMediator;

  /** Register a surface. Throws if `surface.id` is already registered. */
  register(surface: EditorSurface): void {
    if (this._surfaces.has(surface.id)) {
      throw new Error(
        `[SurfaceRegistry] surface id "${surface.id}" is already registered. ` +
        `Call unregister() first or use a distinct id.`,
      );
    }
    this._surfaces.set(surface.id, surface);
  }

  /**
   * Remove a surface from the registry. If the surface was active, activeId
   * becomes null and an onSurfaceChange is fired. The owner's onDeactivate
   * still runs during the implicit deactivation.
   */
  unregister(id: SurfaceId): void {
    const surface = this._surfaces.get(id);
    if (!surface) return;
    if (this._activeId === id) {
      this.activate(null);
    }
    this._surfaces.delete(id);
  }

  get(id: SurfaceId): EditorSurface | null {
    return this._surfaces.get(id) ?? null;
  }

  getByOwner(owner: string): EditorSurface[] {
    const result: EditorSurface[] = [];
    for (const surface of this._surfaces.values()) {
      if (surface.owner === owner) result.push(surface);
    }
    return result;
  }

  get activeId(): SurfaceId | null {
    return this._activeId;
  }

  get activeSurface(): EditorSurface | null {
    return this._activeId === null ? null : this._surfaces.get(this._activeId) ?? null;
  }

  /**
   * Transition the active surface. Pass `null` to return to body (flow doc).
   * Throws from `onCommit` abort the activation; other lifecycle throws are
   * logged to `console.error` so one misbehaving plugin cannot strand the
   * registry mid-transition.
   */
  activate(nextId: SurfaceId | null): void {
    if (nextId === this._activeId) return;

    if (nextId !== null && !this._surfaces.has(nextId)) {
      throw new Error(
        `[SurfaceRegistry] activate("${nextId}") — no such surface registered. ` +
        `Call register() before activate().`,
      );
    }

    const prevId = this._activeId;
    const prev = prevId === null ? null : this._surfaces.get(prevId) ?? null;

    if ((globalThis as Record<string, unknown>).__SURFACE_DEBUG__) {
      const dirtyPart = prev && prev.isDirty ? " [dirty]" : "";
      const ownerPart =
        nextId === null
          ? "body"
          : `${this._surfaces.get(nextId)!.owner}:${nextId}`;
      // eslint-disable-next-line no-console
      console.log(
        `[SurfaceRegistry] activate: ${prevId ?? "body"}${dirtyPart} → ${ownerPart}`,
      );
    }

    if (prev !== null) {
      if (prev.isDirty) {
        prev._committing = true;
        try {
          this._mediator.commit(prev);
        } finally {
          prev._committing = false;
        }
        // Any throw from mediator.commit propagates here — activation aborts.
      }
      try {
        this._mediator.deactivate(prev);
      } catch (err) {
        console.error(`[SurfaceRegistry] onDeactivate("${prev.id}") threw:`, err);
      }
    }

    this._activeId = nextId;

    if (nextId !== null) {
      const next = this._surfaces.get(nextId)!;
      try {
        this._mediator.activate(next);
      } catch (err) {
        console.error(`[SurfaceRegistry] onActivate("${nextId}") threw:`, err);
      }
    }

    this._changeListeners.forEach((h) => h(prevId, nextId));
  }

  /**
   * Debug/inspection snapshot. Safe to call at any time. Not part of the
   * normal operational API — used by devtools, error reporters, and tests.
   */
  snapshot(): {
    activeId: SurfaceId | null;
    surfaces: Array<{ id: SurfaceId; owner: string; isDirty: boolean }>;
  } {
    const surfaces: Array<{ id: SurfaceId; owner: string; isDirty: boolean }> = [];
    for (const s of this._surfaces.values()) {
      surfaces.push({ id: s.id, owner: s.owner, isDirty: s.isDirty });
    }
    return { activeId: this._activeId, surfaces };
  }

  /**
   * Subscribe to activation transitions. Handler receives (prevId, nextId).
   * Called synchronously inside `activate()` after the _activeId flip and
   * after owner lifecycle callbacks have fired.
   */
  onSurfaceChange(handler: SurfaceChangeHandler): Unsubscribe {
    this._changeListeners.add(handler);
    return () => {
      this._changeListeners.delete(handler);
    };
  }

  /**
   * @internal
   * Install the owner lifecycle mediator. Called once by Editor in its
   * constructor, before any plugin can call activate().
   */
  _setOwnerMediator(mediator: SurfaceOwnerMediator): void {
    this._mediator = mediator;
  }
}
