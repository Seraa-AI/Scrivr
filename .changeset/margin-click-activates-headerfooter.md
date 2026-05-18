---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Double-click the page margin to create a header/footer (Word/Docs UX). Previously, a fresh doc with `doc.attrs.headerFooter === null` had a dead margin area — clicks did nothing and the user had to call `setEnabled(true)` from custom UI or pre-seed a policy to even reach the bands.

**@scrivr/core**

- `TileManager`'s `onPageClick` hit test now falls back to `pageConfig.margins.top` / `pageConfig.margins.bottom` when band heights are zero, so the margin strip is always hit-testable. When a real policy is loaded and bands are rendered, the resolved band bounds still win (no regression on documents that already use the chrome bands).

**@scrivr/plugins**

- `tableIntegrityPlugin`'s sibling concern in the HeaderFooter extension: the `chromeClick` listener now bootstraps a policy on double-click instead of bailing when `policy` is null/disabled. Single clicks remain a no-op. Force-enables a lingering disabled policy and creates an empty default slot when `differentFirstPage` is set but the first-page slot wasn't seeded.
- `ensurePolicy()` is now exported from `HeaderFooterController.ts` so the chrome-click handler can reuse the same bootstrap path that the controller's `setEnabled(true)` uses.
- `addPageChrome.measure()` now reserves a default ghost band (empty paragraph slot) on every page when no policy exists, so the margin strip is visually present before the user clicks. The first margin double-click upgrades the ghost into a real on-doc policy.

**@scrivr/react / @scrivr/export-pdf / @scrivr/export-markdown**

- Lockstep version bump only — no API changes.

**Out of scope (follow-ups):**

- Hover-state placeholder ("Click to add header" hint text) — Word/Docs do this on hover only. Worth a separate PR once the activation flow is in.
- Manual playground verification: temporarily comment out `DemoContent` in `apps/docs/src/playground/Playground.tsx` so the policy isn't pre-seeded, then double-click the top margin — header band should appear and gain focus. Body clicks deactivate. Restore `DemoContent` before merging.
