---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Segment-based wrap exclusions. Square-wrap text now flows through every available segment around an anchored object instead of picking one side. Core gets the layout refactor and a latent-bug fix; react gets a UI consolidation; export-pdf gets the renderer-side equivalent. Plugins and export-markdown bump in lockstep with no code changes.

**@scrivr/core**

- **Multi-segment line layout.** `LineBreaker` swapped its single-rect `ConstraintProvider` for a true `LineSpaceProvider` returning `AvailableSegment[]`. A visual line can now span multiple segments — text on both sides of a square-wrap image is filled left-to-right within one line. Lines carry `{ positioned, segments? }` instead of the old `{ constraintX, effectiveWidth }`.
- **`ExclusionManager` is the single source of rect math.** `PageLayout.reflowFlowsAgainstSquareObject` now populates an `ExclusionManager` and queries `getAvailableSegments`, replacing the inlined subtraction helper that had drifted from the manager implementation.
- **Schema: `wrapText` attr removed.** The per-image `largest | left | right` wrap-side override is moot now that both sides are usable simultaneously. Existing documents with `wrapText: "left"` etc. parse fine and silently lose the override (no migration needed — visual outcome is just both-sides wrap from now on).
- **Latent bug fix in `blockHasAnchoredObject`.** The cache-invalidation predicate was reading legacy `wrappingMode` only. Combined with the new ImageMenu writing `{ wrapMode, wrappingMode: "inline" }`, anchored images set via the new menu were misclassified as inline. Now reads through `normalizeImageAttrs` so canonical and legacy attrs both resolve.
- **Tests:** `ExclusionManager.test.ts` covers `getAvailableSegments` and `getNextFreeY`. `PageLayout.test.ts` asserts that segmented lines preserve word order across the exclusion hole (no drops or duplicates).

**@scrivr/export-pdf**

- Renderer skips alignment / justify offsets when `line.positioned`, since segmented lines carry final absolute span x values. Removed an `as`-cast that had been working around a stale type import.

**@scrivr/react**

- `ImageMenu` collapses `square-left` + `square-right` buttons into a single `square` toggle — the wrap-side preference is no longer meaningful with segment-based exclusions. `resolveWrappingMode` shims legacy persisted values.

**@scrivr/plugins**, **@scrivr/export-markdown**

- No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version.
