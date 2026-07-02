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

Commands `setCitationHighlights(citations)` / `addCitationHighlight(citation)`
/ `citeSelection()` / `citeNode(nodeId)` / `removeCitationHighlight(id)` /
`clearCitationHighlights()` work headlessly on `ServerEditor`. `citeSelection`
with a caret cites the enclosing block; `citeNode` cites the block stamped
with a UniqueId nodeId (the AI-answer flow, paired with the `revealCitedNode`
helper). Painting
reuses the core `renderSelection` two-pass renderer via
`addOverlayRenderHandler`, so multi-line, multi-page, and empty-paragraph
ranges render like native selection. Highlight color is configurable via
`CitationHighlight.configure({ color })`. `revealCitation(editor, citation)`
upserts one highlight and scrolls it into view — the "click a citation chip,
jump to the passage" affordance. The extension registers Cite/Uncite toolbar
items (group `"citation"`) for data-driven toolbars.

`@scrivr/core` — new `Editor.scrollRangeIntoView(from, to?)` on `IEditor`.

Scrolls an arbitrary doc range into view: centered when it fits the
viewport, top-pinned when taller, no-op when already visible. Completes a
partial streamed layout first when the target lies beyond the laid-out
region, and virtualized pages paint automatically after the jump. The
existing cursor scroll (`scrollCursorIntoView`) now shares the same
page-to-container coordinate conversion.
