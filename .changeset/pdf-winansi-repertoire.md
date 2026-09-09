---
"@scrivr/export-pdf": patch
---

Fix the WinAnsi allowlist, which was wrong in both directions.

It admitted all of Latin Extended-A, none of which the standard PDF fonts can
encode, so a document containing `Ł`, `ň`, `ş` or `ő` aborted the entire export
with `WinAnsi cannot encode`. It also excluded characters that *are* encodable
— most visibly the euro sign, silently replaced with `?`. The allowlist is now
the exact repertoire pdf-lib's encoder accepts, and a test reads that
repertoire back out of the encoder so the two cannot drift apart.

Text is no longer reduced to WinAnsi when it will be drawn in an embedded font.
Sanitizing ran before font resolution, so supplying a Unicode font via
`fontResolver` still produced `????` — the text was destroyed before anyone
knew a capable font was available. Resolution now happens first and only
standard-font text is reduced. List markers are sanitized too; they are always
drawn in the standard fallback and were not guarded at all.

`PdfFontRegistry` gains an `isUnicode(font)` method, which the resolution-first
ordering needs. Additive for callers; breaking only for code that implements
the interface itself.
