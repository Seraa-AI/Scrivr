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

// Typed `globalThis.__SURFACE_DEBUG__` flag used by activate() transition logs.
// Augmentation keeps consumers from needing casts.
declare global {
  // eslint-disable-next-line no-var, vars-on-top
  var __SURFACE_DEBUG__: boolean | undefined;
}

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
  /** Cached to avoid re-looking up on every hot-path getState/dispatch call. */
  private _activeSurface: EditorSurface | null = null;
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
   *
   * Commit failures during teardown are logged and swallowed — unregister is
   * semantically "tear this surface down", and a throwing onCommit there
   * would otherwise leave the surface both registered and active (worse than
   * dropping the persist). Callers that want commit-or-abort semantics
   * should call `activate(null)` explicitly first, handle the throw, and
   * then `unregister()`.
   */
  unregister(id: SurfaceId): void {
    const surface = this._surfaces.get(id);
    if (!surface) return;
    if (this._activeId === id) {
      try {
        this.activate(null);
      } catch (err) {
        console.error(
          `[SurfaceRegistry] unregister("${id}") — onCommit threw during ` +
          `implicit deactivation; swallowed because teardown cannot abort. ` +
          `Activate(null) explicitly before unregister() to handle commit ` +
          `failures.`,
          err,
        );
        // Force the active state to null since the commit aborted activation.
        this._activeId = null;
        this._activeSurface = null;
        this._changeListeners.forEach((h) => h(id, null));
      }
    }
    this._surfaces.delete(id);
  }

  /**
   * Tear down the registry. Unregisters every surface (which runs each
   * owner's onDeactivate via the implicit activate(null)), clears all
   * subscribers, and resets the owner mediator to a no-op so any stray
   * callers after destroy don't fire owner callbacks.
   *
   * Called by `Editor.destroy()`. After this, the registry should not be
   * reused — but accidental calls on a destroyed registry are safe no-ops.
   */
  destroy(): void {
    if (this._activeId !== null) {
      try {
        this.activate(null);
      } catch {
        // Same rationale as unregister — teardown cannot abort.
        this._activeId = null;
        this._activeSurface = null;
      }
    }
    this._surfaces.clear();
    this._changeListeners.clear();
    this._mediator = noopMediator;
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
    return this._activeSurface;
  }

  /**
   * Transition the active surface. Pass `null` to return to body (flow doc).
   * Throws from `onCommit` abort the activation; other lifecycle throws are
   * logged to `console.error` so one misbehaving plugin cannot strand the
   * registry mid-transition.
   *
   * Re-entrancy: if an owner callback (onCommit/onDeactivate/onActivate) or
   * an onSurfaceChange listener calls `activate()` again, the nested call
   * runs to completion, fires its own listeners, and the outer call detects
   * that `_activeId` was superseded and skips its own listener fire — so
   * listeners always observe the true chronological sequence of transitions
   * without any stale `(prev, next)` pairs.
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
    const prev = this._activeSurface;

    if (globalThis.__SURFACE_DEBUG__) {
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
    this._activeSurface = nextId === null ? null : this._surfaces.get(nextId)!;

    if (nextId !== null) {
      // `this._activeSurface` is non-null on this branch by construction;
      // re-read it fresh so a nested activate() inside mediator.activate()
      // sees the post-flip reference.
      const next = this._activeSurface!;
      try {
        this._mediator.activate(next);
      } catch (err) {
        console.error(`[SurfaceRegistry] onActivate("${nextId}") threw:`, err);
      }
    }

    // Supersession guard: if a nested activate() ran and changed `_activeId`
    // to something other than what this call was trying to land on, a
    // listener fire here with (prevId, nextId) would misrepresent state
    // the user never observed. The nested call already fired the correct
    // listeners for the actual path taken — skip ours.
    if (this._activeId !== nextId) return;

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
