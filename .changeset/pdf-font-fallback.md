---
"@scrivr/export-pdf": patch
---

Fix PDF export when a document names a font the exporter cannot embed.

The WinAnsi allowlist was wrong in both directions. It admitted all of Latin
Extended-A, none of which the standard PDF fonts can encode, so a document
containing `Ł`, `ň`, `ş` or `ő` aborted the whole export with `WinAnsi cannot
encode`. It also excluded characters that *are* encodable — most visibly the
euro sign, silently replaced with `?`. The allowlist is now the exact
repertoire pdf-lib's encoder accepts, and a test reads that repertoire back out
of the encoder so the two cannot drift apart.

Text is no longer reduced to WinAnsi when it is drawn in an embedded font.
Sanitizing ran before font resolution, so supplying a Unicode font via
`fontResolver` still produced `????` — the text was destroyed before anyone
knew a capable font was available. Resolution now happens first and only
standard-font text is reduced. List markers are sanitized too; they are always
drawn in the standard fallback and were not guarded at all.

Adds `onFontSubstitution` to `PdfExportOptions`, called for each named font
that could not be embedded. A substituted font's metrics are not the ones the
layout was measured against, so lines do not break where the canvas broke
them — until now that happened silently.

`PdfFontRegistry` gains an `isUnicode(font)` method. Additive for callers;
breaking only for code that implements the interface itself.

`PdfExport` gains an `onFontSubstitution` option, called once per export with
every substitution made. It defaults to a console warning, so an app that wires
nothing still surfaces the mismatch instead of shipping a silently wrong PDF.

`PdfExport` also forwards `fontResolver`, so an app using the extension can
supply the real font instead of only being told one was missing.
