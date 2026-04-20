---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/plugins": patch
---

Refactor monolithic `buildPdf()` into a 7-phase handler dispatch pipeline. Extensions can now contribute PDF node/mark/chrome handlers via `addExports()`.

- `@scrivr/core`: add `ExtensionManager.getExportContributions()` and `BaseEditor.getExportContributions()` on `IBaseEditor`; fix missing `text` + `hardBreak` markdown serializer rules in Document extension
- `@scrivr/export-pdf`: extract `PdfContext`, `PdfDrawHelpers`, `PdfFontRegistry`, and default node/mark handlers into dedicated modules; fill `PdfHandlers` with real typed interfaces (`PdfNodeHandler`, `PdfMarkHandler`, `PdfChromeHandler`)
- `@scrivr/export-markdown`: fill `MarkdownHandlers` with `MarkdownNodeHandler` and `MarkdownMarkHandler`; widen `exportToMarkdown()` to accept `BaseEditor`; add 12 tests
