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

`renderPage` abandons a paint when the layout moves under it, which is right —
painting a page from a layout that no longer exists puts stale pixels on
screen. It abandoned silently, though, and `TileManager` stamped the tile's
`lastPaintedVersion` either way. A tile that believes it painted a version it
never drew will not repaint until something unrelated moves it, so the reader
sees an edit go missing.

- **`@scrivr/core`** — `renderPage` returns whether it painted. `TileManager`
  stamps `lastPaintedVersion` / `lastRenderGeneration` only on a completed
  paint, so an abandoned page is retried on the next update instead of being
  recorded as done.

Behaviour is unchanged when paints succeed, which is the normal path.
