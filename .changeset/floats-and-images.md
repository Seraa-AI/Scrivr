---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/react": patch
"@scrivr/ai": patch
---

Any inline node can float: its spec declares `anchored(node)` and the engine
places, wraps, hits, drags and exports it as it does an image. Images behave
exactly as before.

- `anchoredOf(node)`, `floats(node)` and `AnchoredPlacement` are new;
  `isXAlignValue` is exported.
- `addPasteFiles()` declares which pasted files become which nodes
  (`PasteFileSpec`, `PasteFileHandler`); `ExtensionManager.buildPasteFiles()`
  and the `pasteFiles` option of `PasteTransformer` carry them.
- `addExports().pdf.embeds` (`PdfEmbedSource`) declares where a node's
  embedded file lives.
- `INLINE_IMAGE_ATTRS` is exported from Image.

**Breaking:**

- `normalizeImageAttrs` and `NormalizedImageAttrs` are removed: read a node's
  placement with `anchoredOf` (`AnchoredPlacement`).
- `Editor.convertImageToInlineAtVisualPosition(docPos)` is now
  `placeInlineAtVisualPosition(docPos, INLINE_IMAGE_ATTRS)`.
- A `PasteTransformer` built without `pasteFiles` inserts no pasted files;
  `Editor` passes them.
