---
"@scrivr/plugins": patch
"@scrivr/ai": patch
"@scrivr/react": patch
---

A diff op now says where in the proposal it came from, and the ops reconstruct
the proposal they were built from.

`pairReplacements` emits deletes first so a consumer clears a whole deleted
range before writing its replacement — that is what keeps document-side offsets
correct, and it stays. What follows consumes the proposal, and is now emitted in
the proposal's own order. Absorbing a keep that sits inside a replacement turns
it into a re-insert, and that re-insert can belong *before* a boundary keep:
rewriting "alpha beta gamma delta" to "beta delta epsilon" moved "beta" behind
"delta" and applied as " deltabeta epsilon". The ops described something the
proposal never said.

Each op that consumes the proposal carries `proposedOffset`, stamped where the
order still is the proposal's own. A consumer counting as it walks cannot
recover it, because the order it walks is the document's — which is how an
agent's bold landed on a word it never named.

Text that did not change is one keep, however long. The quadratic guard answered
"delete everything, insert everything" for two identical strings, so a
formatting proposal on a paragraph over ~450 characters — ordinary in a
contract — rewrote every character to change none of them, taking comment
anchors and existing tracked marks with it.

Generated group ids carry their block. They were an index into one block's ops,
so two paragraphs with a change at the same position shared an id, and settling
one settled the other.

`resolvedGroups` is read through one `liveOps(block)` by everything that draws,
offers or applies a proposal, so a settled group stops drawing its underline and
stops offering a card whose accept did nothing. Settling dispatches its own
`AI_SUGGESTION_RESOLVE` rather than replacing the suggestion, which used to
clear the active block and blank the rest of the overlay until the caret moved.

A card can say `kind: "format"`; a formatting proposal was reported as a
deletion labelled with the paragraph's own text. The popover describes it
through `formattedText` instead of rendering an empty replaced→inserted pair.
`FormatRenderInstruction` is exported, so a consumer can name the arm it
narrows to. The underline groups glyphs by `lineY`, so a run of mixed sizes
draws one straight rule rather than disjoint stubs.
