---
"@scrivr/ai": patch
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**Paste improvements**

`@scrivr/core`

- **Slice-accurate paste.** Copying now records the slice's open depths on the clipboard HTML (`data-pm-slice`, ProseMirror's own convention), and pasting rebuilds that slice exactly. Copy/paste inside the editor round-trips, including whitespace, which is document content in an internal slice but collapsible markup in foreign HTML.
- **Inline HTML no longer splits the paragraph.** `fromHtml` previously forced `openStart: 0`, so pasting an inline fragment mid-sentence broke the paragraph into three. Openness is now derived from the pasted content: a default-attr paragraph merges into the cursor's block (matching Word/Docs), while anything carrying its own identity — a heading, a list, an aligned paragraph — stays a separate block and keeps its attrs.
- **Paste without formatting (`Mod-Shift-v`).** Inserts the clipboard's text form only, skipping both HTML and markdown inference.
- **Multi-line plain text becomes paragraphs** instead of one paragraph holding newline characters the canvas cannot render.
- **Image paste.** A screenshot or image file on the clipboard is inserted as an image node, sized to its natural dimensions and scaled to fit the page. The default embeds an inline `data:` URL; the new `uploadPastedImage` editor option takes the bytes and returns a URL instead. Ignored when the clipboard also carries HTML, so a web-page image copy is not inserted twice.
- **Word/Outlook lists.** Word emits lists as `mso-list`-tagged paragraphs whose bullet is literal text; these are now rebuilt into real `bulletList`/`orderedList` nodes, nesting included, with the marker glyphs dropped.
- **Image placement survives an HTML round-trip.** `wrapMode`, `xAlign`, `x`, `yOffset`, `zIndex`, `margin`, and `verticalAlign` now serialize to and parse from `data-*` attributes; copying a floating image previously pasted it back as inline. One declaration drives both directions.
- **`safeImageUrl`** — image `src` now accepts inline base64 `data:` URLs for raster types (png, jpeg, gif, webp, bmp, avif). `image/svg+xml` stays rejected, since SVG can carry script. Link `href` keeps the stricter `safeUrl` gate. This is what lets a pasted screenshot, and an image imported from a `.docx`, survive ingestion.
- New public exports: `serializeSelectionToHtml`, `serializeSelectionToText`, `SLICE_DATA_ATTR`, `safeImageUrl`, `PasteOptions`, `PasteTransformerOptions`.

`@scrivr/docx`

- Adds a chain round-trip test covering images in all five wrap modes across export → import → clipboard copy → paste.

Other packages are version-only (lockstep).
