---
"@scrivr/export-pdf": patch
---

Make exported links clickable.

A link mark was painted in the theme's link colour and underlined, and that was
all — the exported PDF carried no annotations, so nothing in it could be
followed. Anchors now become real `Link` annotations with a `URI` action.

Spans are merged per target across a line, so a link whose formatting changes
mid-anchor (a bolded word inside it) stays one hit area rather than several,
and a link that wrapped gets one annotation per line. Targets pass `safeUrl`,
the same gate the editor applies on ingestion, rather than a second URL policy
written for this sink — a `javascript:` href yields no annotation.
