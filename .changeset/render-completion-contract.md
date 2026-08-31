---
"@scrivr/core": patch
"@scrivr/ai": patch
"@scrivr/docx": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**A tile records a version only if it painted that version**

Painting a page from a layout that has already been replaced puts stale pixels
on screen, so a paint that sees the layout move under it should abandon. It
abandoned silently, though, and `TileManager` stamped the tile's
`lastPaintedVersion` either way. A tile that believes it painted a version it
never drew will not repaint until something unrelated moves it, so the reader
sees an edit go missing.

Abandoning late was its own problem: `setupCanvas` assigns `canvas.width` /
`canvas.height`, and assigning either dimension clears the backing bitmap even
when the value is unchanged. A paint that bailed after that point had already
blanked the tile — the reader looked at an empty page rather than a stale one.

- **`@scrivr/core`** — both painters admit a candidate before touching either
  canvas and reject a stale one outright; past that point the paint runs
  synchronously to completion. `renderPage` reports whether it painted, and
  `TileManager` stamps `lastPaintedVersion` / `lastRenderGeneration` only on a
  completed paint, so an abandoned page is retried on the next update. Pageless
  tiles, which previously had no staleness check at all, now follow the same
  contract.

Behaviour is unchanged when paints succeed, which is the normal path.
