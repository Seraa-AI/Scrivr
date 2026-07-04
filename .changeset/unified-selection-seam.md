---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — unified selection system: one canonical ProseMirror selection
with an extension-owned behavior/geometry/gesture seam.

- **Cleaner mouse selection.** Selecting across multiple lines or block atoms
  (image, horizontal rule, page break) now paints continuous Word/Docs-style
  bands — first line to the margin, middle lines full width, last line to the
  selection end — instead of ragged per-glyph fills that left gaps.
- **`editor.getSelectionDescriptor()`** — a kind-tagged, capability-carrying view
  of the active selection (`kind`, `empty`, `surfaceId`, and a
  `SelectionCapabilities` bag). UI reads this instead of `instanceof`-ing the
  ProseMirror selection.
- **Extension seams** so an extension can own a selection kind on its own terms
  without patching the renderer or pointer controller:
  - `addSelectionBehavior()` — describe + geometry (paint primitives) for a
    selection kind, with a required default fallback for unregistered kinds.
  - `addHitTester()` / `addSelectionGesture()` — turn a pointer position into a
    semantic target and own the resulting drag.

The canvas renderer now paints selection geometry primitives type-blind, and the
pointer controller delegates gestures to registered providers — the same seam a
table cell selection or a custom node plugs into. No app-facing behavior changes
for text or image selection beyond the band-rendering improvement.
