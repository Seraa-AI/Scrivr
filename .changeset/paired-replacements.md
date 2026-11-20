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

A word typed over a selection in suggesting mode is now one change, as Google Docs shows it. The deleted words and the typed words share a `groupId`, so the popover shows one card and deciding either half decides both.

- Text typed on from the replacement, or retyped inside it, joins it.
- An earlier edit beside it stays its own change, and so does another replacement, even side by side.
- Typing over text already struck, or over the author's own insertion, starts no replacement: there is no new deletion to pair.
- A selection across paragraphs is not paired, because typing over it also joins the paragraphs.
