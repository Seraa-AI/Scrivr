---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

yOffset Phase 5 (minimal): top-bottom anchored objects contribute a `side: "full"` rect to the page's shared `ExclusionManager`. Architectural unification — all wrap modes now feed one manager. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 5.

**@scrivr/core**

- **`ExclusionManager.addFullWidthRect(...)` helper.** Closes the spec's correctness gap on `side: "full"` rects: a manually-set `addRect` with `side: "full"` but `x` / `right` narrower than the queried content area silently leaves side segments, which makes `getAvailableSegments` drop the `skipToY` (segments.length ≠ 0 → skipToY suppressed in the return). The helper takes `{ page, y, bottom, contentX, contentWidth, docPos }` and forces the rect to span the content bounds — the failure mode is unreachable.
- **Top-bottom rects flow into the page-level manager.** In `resolveAnchoredObjects`, when `wrapMode === "top-bottom"`, the placement now also contributes a full-width rect via `addFullWidthRect`. Square reflows on the same page therefore see top-bottom bands as real exclusions through the same manager that drives square wrap — Phase 4's per-page `ExclusionManager` now holds rects for *every* anchored wrap mode.
- **Scope choice — minimal V1.** The spec also calls for ripping out the `partKind: "anchored-object"` `FlowBlock` splitting in `buildBlockFlow` so top-bottom and square share the layout-pipeline path entirely. That rewrite forces test rewrites (8+ existing tests assert the image lives as its own layout block separated from "before" / "after" text fragments). Deferred to Phase 5 V2; the current FlowBlock splitting still positions the image vertically for the no-overlap-with-square common case. The user-visible win — top-bottom and square interacting cleanly through one manager — lands now; the structural rip-out is a separate change.
- **Tests.** New `ExclusionManager.test.ts` tests: (1) `addFullWidthRect` produces `skipToY` for overlapping queries, (2) demonstrates the failure mode the helper prevents (manual `addRect` with mismatched bounds suppresses `skipToY`).

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
