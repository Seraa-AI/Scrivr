---
"@scrivr/core": patch
---

A coloured link now keeps its colour on canvas.

Two marks can both want a say in a span's colour, and the renderer resolved it
by array position — last non-undefined wins. ProseMirror orders marks by schema
rank, which puts `link` after `color`, so an explicit colour on a link was
overwritten by the link's blue. The code did the opposite of what its own
comment said ("color marks win"), in two places that had drifted into copies of
each other.

Colour is now resolved once, in one place, by what the value *means* rather
than where it sits: an authored colour beats a mark's semantic default. That is
the cascade OOXML applies — direct run formatting overrides a character style —
so the canvas now agrees with what Word renders from the same document, and
with what the PDF exporter already did.

`MarkDecorator` gains `decorateDefaultFill` for a colour that expresses what a
mark *is* rather than what an author picked; `Link` uses it. Additive —
existing `decorateFill` implementations keep their meaning and now reliably
win.
