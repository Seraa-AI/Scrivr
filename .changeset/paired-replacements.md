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

A word typed over a selection in suggesting mode is now one change, as in Word. The deleted words and the typed words share a `groupId`, so the popover shows one card and deciding either half decides both. Text typed on from the replacement joins it. Two replacements, even side by side, stay two changes. A selection across paragraphs is not paired, because typing over it also joins the paragraphs.
