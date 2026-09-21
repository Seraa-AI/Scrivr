---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

A header being edited is measured with the page's own resolver

The live header and footer path re-lays its content out as you type, and it was
handed no font resolver — so it measured against the family the document names
rather than the face that draws it. The stored path, which runs the moment the
caret leaves the band, does use the resolver. The two therefore disagreed about
line breaks, and once missing weights began being synthesized they disagreed
about weight too: a bold header went flat while you edited it and thickened
when you clicked away.

`Editor.fontResolver` exposes what the page was measured with, and the chrome
paint context carries it so a contributor laying out its own content uses the
same one.
