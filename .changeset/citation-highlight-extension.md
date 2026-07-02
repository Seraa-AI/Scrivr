---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/plugins` — new `CitationHighlight` extension.

Paints translucent highlight rects over document ranges referenced by an
external citation (e.g. an AI answer citing a passage). The highlight is
ephemeral view state: nothing is written into the document, nothing syncs to
collaborators, and undo history is untouched. Ranges live in ProseMirror
plugin state, remap through every edit (text typed at a boundary stays
outside the highlight), and a citation whose text is deleted disappears.

Commands `setCitationHighlights(citations)` / `clearCitationHighlights()`
work headlessly on `ServerEditor`; painting reuses the core `renderSelection`
two-pass renderer via `addOverlayRenderHandler`, so multi-line, multi-page,
and empty-paragraph ranges render like native selection. Highlight color is
configurable via `CitationHighlight.configure({ color })`.
