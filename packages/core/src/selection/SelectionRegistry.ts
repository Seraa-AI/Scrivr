import type { Selection } from "prosemirror-state";
import type { SelectionBehavior } from "./types";

/**
 * Resolves the `SelectionBehavior` for a `Selection`. Behaviors are tried in
 * registration order (extensions first, core built-ins last); the `fallback`
 * matches anything, so a selection kind no extension registered — e.g. a Seraa
 * custom node's selection — is still describable, paintable, and copyable rather
 * than silently dropped.
 */
export class SelectionRegistry {
  constructor(
    private readonly behaviors: readonly SelectionBehavior[],
    private readonly fallback: SelectionBehavior,
  ) {}

  resolve(selection: Selection): SelectionBehavior {
    for (const behavior of this.behaviors) {
      if (behavior.matches(selection)) return behavior;
    }
    return this.fallback;
  }
}
