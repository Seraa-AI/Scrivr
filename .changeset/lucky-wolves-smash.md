---
"@scrivr/export-pdf": patch
---

Keep apostrophes and quotes in the exported PDF's text layer.

Every glyph is named from the font's cmap before any text is measured. fontkit
keeps the glyph object it built first, and shaping can build one with no
codepoint attached - measuring a word containing `“ ”` in Inter is enough - so
pdf-lib then wrote an empty `ToUnicode` entry for the single quotes. The page
still painted correctly, while copying or searching the text silently dropped
every apostrophe in the document.
