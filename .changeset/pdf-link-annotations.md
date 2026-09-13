---
"@scrivr/export-pdf": patch
---

Make exported links clickable.

A link mark was painted in the theme's link colour and underlined, and that was
all — the exported PDF carried no annotations, so nothing in it could be
followed. Anchors now become real `Link` annotations with a `URI` action.

Adjacent spans with the same target are merged across a line, so a link whose
formatting changes mid-anchor (a bolded word inside it) stays one hit area
rather than several, and a link that wrapped gets one annotation per line.

Targets pass `safeUrl` — the gate the editor applies on ingestion, rather than
a second URL policy for this sink — and must additionally be followable
without a base URL. `safeUrl` admits fragments and relative paths, which are
safe to store but resolve to nothing in a downloaded PDF; annotating them
would put a hand cursor over text that does not navigate. Only `http`,
`https`, `mailto` and `tel` targets are annotated.
