---
"@scrivr/ai": patch
---

An AI suggestion can now be about how the text reads, not only what it says.

`computeAiSuggestion` takes `proposedSpans` alongside `proposedText`. Plain text
is the narrow case of the same thing — a proposal that says nothing about
formatting, which is the same statement as "no marks" — so there is one path,
not two. `AiOp` carries the marks of the run it proposes, and an op whose
formatting changes partway is split so that an op always reads one way.

Two things this makes possible that were not expressible before. A proposal can
be about formatting alone, where the wording is untouched: every op is a `keep`,
so the change is found by comparing the formatting the block would end up with
against the formatting it has. And an accepted insertion now lands with its
marks — both the direct and the tracked apply build their content the same way,
so a suggested bold term is bold once accepted instead of quietly flattening.

`applyRichEdit` and `applySemanticEdits` no longer accept `asSuggestion`. It was
declared on both and read by neither, so `asSuggestion: false` returned
`applied: true` having applied a tracked suggestion — the opposite of what the
caller asked for. Both always apply as suggestions, which is what an agent's
edit is; applying agent output straight into the document is the existing
`applyAiSuggestion({ mode: "direct" })` lane.
