---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Anchored-object drag UX hardening + critical drag fix. Core gets the behavior changes; export-pdf gets a type rename to match; react/plugins/export-markdown bump in lockstep with no code changes.

**@scrivr/core**

- **Square-right images now draggable.** Fixed `resolveXAlign` legacy shadow bug — `wrappingMode: "square-right"` was overriding explicit `xAlign: "custom"` set by drag commits, so right-flushed images stayed pinned regardless of drop target. Explicit non-default `xAlign` now always wins.
- **Drag UX hardening.** Edge-band resize handles (12px) so inner image body is reachable for body drag instead of the 8-handle grid stealing every click. Clamp-no-move guard skips no-op PM transactions when drag clamps to source X. Inter-page gap drops are flagged invalid: ghost goes disabled, no transaction dispatched. Cross-page drag onto a virtualized destination falls back to layout-page block scan instead of silently collapsing to docPos 0.
- **Single source of truth for image rects.** New `editor.getNodeRect(docPos)` reads `layout.anchoredObjects` first (Stage 3 authoritative), falls back to `charMap` for inline images. Resize handles + selection rendering now derive from the same coordinates as body drag.
- **Drag debug overlay.** New `DragDebugOverlay` paints solver vs charMap rects (green vs yellow) and the page-gap zone (red strip) when `editor.debug = { drag: true }`. `dragDebugLog` emits structured `[drag]` events at down/move/commit/clampedNoMove/gapDrop.
- **Phase 1b cache invalidation for square wrap zones.** New `flow.overlapsWrapZone` flag stamped during `reflowFlowsAgainstSquareObject`; `paginateFlow` now skips cached-tail reuse when an upstream wrap zone changed. Closes a silent layout-staleness gap when image attrs flip between runs.
- **wrap-side spec hint.** `docs/anchored-objects/04-edit-ux.md` now documents the v1 wider-side wrap behavior with a tooltip spec for the future Square wrap-mode picker.

**@scrivr/export-pdf**

- Renamed `floats` → `anchoredObjects`, `FloatLayout` → `AnchoredObjectPlacement`, and collapsed `mode: "square-left" | "square-right"` to `wrapMode: "square"` to match the core API. Anchor field renamed `anchorBlockY` → `anchorGlobalY`. Internal helper `drawPdfFloat` → `drawPdfAnchoredObject`. No behavior change — pure rename to track the core type surface.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

- No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version.
