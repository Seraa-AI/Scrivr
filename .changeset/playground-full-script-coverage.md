---
"@scrivr/core": patch
---

Playground fonts cover every script the demo can be handed

The docs playground registered `@fontsource`'s Latin subsets — the arrangement
the web normally uses, where one file per script is chosen by `unicode-range`.
That assumes the browser picks a file per character, which does not hold here:
a `FontResource` is one set of bytes, and those bytes have to serve canvas
measurement and PDF embedding alike.

The Latin subset holds 231 glyphs, so pasting Cyrillic or Greek into the
playground would have rendered in a face nobody chose on canvas and drawn
blanks in an exported PDF. It now uses `inter-ui`'s unsubsetted files: one file
per face, 2852 glyphs, covering Latin, Latin Extended, Greek, Cyrillic and
Vietnamese.

No engine change — the typography guide now explains why an unsubsetted file
per face is the right packaging for this model.
