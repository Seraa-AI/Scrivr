---
"@scrivr/core": patch
"@scrivr/docx": patch
---

DOCX export now writes one wrapper element around consecutive runs that share a wrapping mark, as Word does. For example, a link over bold and plain text is now one `<w:hyperlink>`, not two. `DocxRunWrapper` receives all the runs (`runs: readonly XmlNode[]`) and may return several nodes. DOCX import now lets several extensions claim the same element: a later `blocks`, `inlines` or `marks` handler that returns `null` falls through to an earlier one instead of hiding it. A mark with a wrapper and no run-properties handler exports without an `unsupported-mark` warning. A line break inside a wrapping mark joins its stretch, so a link or field across a break is one element.
