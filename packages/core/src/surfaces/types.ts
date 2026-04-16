/**
 * Multi-surface types. A surface is an independent document region the user
 * can edit (headers, footnote bodies, comment threads, margin notes). The
 * body/flow document is the implicit default surface, represented by a null
 * active id rather than a dedicated surface object — see Invariant 5 in
 * `docs/multi-surface-architecture.md` §4.
 */

import type { EditorSurface } from "./EditorSurface";

/** Opaque string identifier. Plugin-owned namespace (e.g. `"headerFooter:default"`). */
export type SurfaceId = string;

/** Cleanup callback returned by subscription helpers. */
export type Unsubscribe = () => void;

/**
 * A plugin's registration with the surface system. Declared via
 * `Extension.addSurfaceOwner()` and collected by `ExtensionManager`. The
 * `owner` string uniquely namespaces every surface the plugin creates.
 *
 * Lifecycle callbacks are fired by the registry during `activate()`:
 *   - onCommit(prev): prev was dirty — persist to flow doc. Throwing aborts activation.
 *   - onDeactivate(prev): prev is leaving active. Throws are logged, not fatal.
 *   - onActivate(next): next just became active. Throws are logged, not fatal.
 */
export interface SurfaceOwnerRegistration {
  /** Plugin's namespace — must be unique across extensions. */
  owner: string;
  onActivate?(surface: EditorSurface): void;
  onDeactivate?(surface: EditorSurface): void;
  onCommit?(surface: EditorSurface): void;
}
