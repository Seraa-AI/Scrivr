---
"@scrivr/core": patch
---

A coloured link keeps its colour on canvas.

An explicit colour on a link was overwritten by the link's blue, because the
renderer resolved competing colours by mark order and `link` sorts last. An
authored colour now wins over a colour a mark supplies for being what it is,
in any order — matching what Word renders from the same document, and what the
PDF exporter already did.

`MarkDecorator` gains `decorateDefaultFill` for the second kind; `Link` uses
it. Additive: existing `decorateFill` implementations keep their meaning.
