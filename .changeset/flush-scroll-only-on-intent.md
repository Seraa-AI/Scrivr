---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — the render flush now scrolls the cursor into view only when a
transaction intended it.

Every transaction converges on `viewDispatch` → `scheduleFlush`, whose rAF
previously called `scrollCursorIntoView()` unconditionally. That meant any
programmatic or remote transaction — a collaborator's edit, an AI overlay, or a
citation highlight — yanked the viewport back to the local caret. Most visibly,
`revealCitation` set its highlight (via `applyTransaction`) and then scrolled the
cited range into view, only for the next frame's flush to scroll back to the
cursor.

Local edits and commands still scroll the caret into view as before. External
transactions (those dispatched through `applyTransaction`: Y.js, AI toolkit/
suggestions, header/footer, citation highlights, imports) now scroll only when
they explicitly called `tr.scrollIntoView()`. So `revealCitation` and
`scrollRangeIntoView` land on the cited passage and stay there.
