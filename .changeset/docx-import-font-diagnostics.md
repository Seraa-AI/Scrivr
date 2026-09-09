---
"@scrivr/docx": patch
---

Report fonts a document names that the environment cannot draw.

A DOCX carries the fonts it was written in. When one is missing, the browser
substitutes a face silently, the layout is measured against that substitute,
and every consumer of the layout inherits a discrepancy nothing downstream can
detect — by then the substitution is already folded into the geometry. Import
previously returned zero diagnostics for such a document.

`importDocx` now emits an `unavailable-font` warning per distinct missing
family. Availability comes from `DocxImportOptions.fontAvailability`, which
defaults to a canvas measurement probe in the browser and to nothing on the
server, where there is no font system to ask. `document.fonts.check()` is
deliberately not used: it reports whether a face is loaded and returns true for
families the browser will substitute.

`DocxImport` gains an `onDiagnostics` option, called once per import that
produced any. It defaults to the console warning the extension already emitted,
so apps that wire nothing keep today's behaviour.
