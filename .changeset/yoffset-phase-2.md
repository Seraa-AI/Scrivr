---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

yOffset Phase 2: drag commits `yOffset`, anchor stays put. Anchored images can now be dragged anywhere on their page without parenting to a different paragraph. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 2.

**@scrivr/core**

- **`PointerController` drag rewrite.** At pointerdown we snapshot the anchor flow's globalY, the image's painted globalY, and the current `yOffset` from `placement.anchorGlobalY` / `placement.globalY` (Phase 1 fields). The snapshot is frozen for the gesture's lifetime — drag math never reads live layout, so vertical drag no longer feeds back into the anchor position.
- **Same-page drag → `setNodeAttrs({ xAlign, x, yOffset })`.** Pure attr update; the image's docPos doesn't change. The user-visible behavior is the one the redesign was about: "drag an image anywhere on its page and it stays put — the anchor doesn't drift to another paragraph because the cursor passed over one."
- **Cross-page drag → `moveAndUpdateNode({ ..., yOffset: 0 })`.** Anchor relocates to a paragraph on the new page in one transaction; `yOffset` resets so the image lands at the new anchor's natural position. (Preserving exact visual position across the page break — adjusted yOffset against new anchor's globalY — needs a `pageStartGlobal` helper not yet exposed to PointerController; deferred to a follow-up.)
- **Y_THRESHOLD = 3px on same-page commits.** Mirrors the existing horizontal threshold. A "pure horizontal" drag with natural mouse jitter (≤3px Y wobble) doesn't write a spurious `yOffset`.
- **Tests updated.** `PointerController.test.ts` and `PointerController.dragUX.test.ts` switched from the old commit matrix (moveAndUpdateNode for diagonal, moveNode for vertical) to the new one (setNodeAttrs same-page, moveAndUpdateNode cross-page). Pure-horizontal tests now use `dy=0` to assert that `yOffset` is omitted when there's no vertical intent.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning. Drag UX is core-side; React just mounts the renderer.
