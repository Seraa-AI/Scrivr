---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

New opt-in debug overlay that visualises anchored-object placement state on the canvas. Useful when "the image looks wrong" — paints the exclusion area, the page-edge clamp boundary, and the paint-order metadata that normally lives only in `LayoutPage.anchoredObjects[]`.

**@scrivr/core**

- New `AnchoredObjectDebugOverlay.ts` — `installAnchoredObjectDebugOverlay(editor)` registers an overlay render handler that, when `editor.debug.anchoredObjects` is true, paints on every visible page:
  - **Wrap-zone fill** (translucent blue) at the margin-inflated exclusion rect. Square wrap inflates on all four sides; top-bottom inflates top/bottom only and spans the full content width. Behind/front contribute no exclusion and so render no fill.
  - **Clamp outline** (red, 2px) around the painted rect when `placement.clamped` is true.
  - **wrapMode + zIndex label** pinned to the painted rect's bottom-right corner.
- `DragDebugConfig.anchoredObjects?: boolean` — new config slot, gated by `editor.debug.anchoredObjects`.
- The overlay is always installed (zero cost when the flag is off); flip the flag at runtime via `editor.debug.anchoredObjects = true; editor.redraw()`.
- **Tests.** 7 new cases covering: handler registration, no-op when flag is off, paint invocation when flag is on (square + top-bottom + behind/front variants), clamp outline, and per-page filtering.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
