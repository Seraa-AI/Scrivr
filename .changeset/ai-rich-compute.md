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
against the formatting it has, and applying it sets the marks on the kept run —
adding what the proposal asks for, removing what it drops, and leaving
tracked-change marks alone because those describe review state rather than how
the text reads. And an accepted insertion now lands with its marks, so a
suggested bold term is bold once accepted instead of quietly flattening.

Marks are compared attrs-aware and order-insensitively. Document marks arrive in
schema order and an agent emits them in whatever order it wrote them, so a
literal comparison would read a reordered `[bold, italic]` as a change, and a
link whose `href` the proposal restates would read as one too.

`proposedSpans` takes the protocol's own inline runs, so `parseSemanticEdits`
output feeds `computeAiSuggestion` directly. The package publishes one vocabulary
for inline runs and every public entry point speaks it; a consumer holding
validated agent output should not have to convert between two spellings of the
same thing, least of all in a repo that gives it no `as` to do it with.

`applyRichEdit` and `applySemanticEdits` no longer accept `asSuggestion`. It was
declared on both and read by neither, so `asSuggestion: false` returned
`applied: true` having applied a tracked suggestion — the opposite of what the
caller asked for. Both always apply as suggestions, which is what an agent's
edit is; applying agent output straight into the document is the existing
`applyAiSuggestion({ mode: "direct" })` lane.
