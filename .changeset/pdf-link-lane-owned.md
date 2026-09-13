---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A mark declares where it points, so clickability is owned by the extension too.

Link styling moved onto the `Link` extension, but the exporter still found the
target by looking for a mark literally named `link`. A kit that renamed the
mark, or shipped a second link-like one — a citation, a cross-reference — got
the blue and the underline and no clickable area, which is the by-name
knowledge the migration exists to remove, surviving in the lane where it is
hardest to notice.

`PdfSpanStyle` gains `link`. Targets are still checked at the boundary rather
than trusted from a handler: `safeUrl` for safety, and a scheme a reader can
follow without a base URL, so a fragment or relative path is dropped instead of
becoming a hit area that goes nowhere.
