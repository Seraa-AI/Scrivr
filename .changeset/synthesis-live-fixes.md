---
"@scrivr/core": patch
---

Synthesized text is painted in its own colour, and at a weight you can see

Two faults found by looking at the canvas rather than at the tests.

`paintText` set the stroke colour and left the fill to whoever called it. The
block strategy used to set `fillStyle` immediately before its `fillText` and
that line went when the call was replaced, so every run was filled with
whatever colour the context last held — a document of outlined headings on a
pale ground, with no test failing, because the tests assert which calls happen
and not what colour they use. The painter sets its own fill now.

The emboldening was also half a bold. Measured on the canvas: at 64px Inter's
regular stem is 5px and its bold stem is 10px, and a straddling stroke adds its
full width to a stem — so a full weight step is a shade under 0.08em, not the
0.028em that was there. In the heading of a real contract that is 11.8% ink
against a designed bold's 15.4%; at 0.07em it is 14.6%. Counters stay open at
11px.
