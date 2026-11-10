---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/react": patch
"@scrivr/ai": patch
---

Any inline node can float: its spec declares `anchored: { read, write }` and
the engine places, wraps, hits, drags, resizes and exports it as it does an
image, writing every placement change through `write`. Images behave exactly
as before.

- `anchoredOf(node)`, `floats(node)`, `placementAttrs(node, patch)`,
  `AnchoredPlacement`, `AnchoredSpec` and `PlacementPatch` are new;
  `isXAlignValue` is exported. A node that declares a placement is laid out at
  the size it declares.
- `addPasteFiles()` declares which pasted files become which nodes
  (`PasteFileSpec`, `PasteFileHandler`); `ExtensionManager.buildPasteFiles()`
  and the `pasteFiles` option of `PasteTransformer` carry them.
- `addExports().pdf.embeds` (`PdfEmbedSource`) declares where a node's
  embedded file lives.
- A later-registered extension takes a pasted file first, and
  `normalizeDocument`'s new `pasteFiles` option sweeps any extension's
  orphaned placeholder.
- An agent's image layout is written through the node's declaration.

**Breaking:**

- `normalizeImageAttrs` and `NormalizedImageAttrs` are removed: read a node's
  placement with `anchoredOf` (`AnchoredPlacement`).
- `Editor.convertImageToInlineAtVisualPosition(docPos)` is now
  `placeInlineAtVisualPosition(docPos)`, for any anchored node.
- `dropPendingPlaceholders(doc, isPending)` takes the predicate;
  `normalizeDocument` sweeps placeholders only for the `pasteFiles` it is
  given (the editors pass theirs).
- A `PasteTransformer` built without `pasteFiles` inserts no pasted files;
  `Editor` passes them.
- `ResolvedExtension.pasteFiles` is required: a hand-built resolved extension
  passes `{}`.
