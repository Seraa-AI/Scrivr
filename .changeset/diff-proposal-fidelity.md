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

Settling one group re-expresses what is left of the proposal against the
document that group left behind. A suggestion's ops are offsets into the block's
text as it was when the suggestion was computed, so accepting or rejecting one
group invalidated every remaining op: the next accept landed on the wrong
characters, or past the end of the old text, where it silently did nothing —
accept a rewrite, then accept the formatting alongside it, and the formatting
never arrived.

Marking a group settled and stepping over it does not fix that, because the
offsets are still the old ones. So there is no settled-group bookkeeping at all
now: the outcome is known where the group is settled, the remaining proposal is
rebuilt there, and a settled group simply no longer exists. A block with nothing
left to propose is removed, and a suggestion with no blocks left is cleared —
an empty proposal used to be reported as a deletion of the whole paragraph.

Settling dispatches `AI_SUGGESTION_RESOLVE` rather than replacing the
suggestion, which used to clear the active block and blank the rest of the
overlay until the caret moved.

`AiSuggestionCardData.kind` gains `"format"`. Additive for a consumer that
switches with a default, but a consumer narrowing exhaustively against `never`
will stop compiling until it handles the new member — which is the point of
writing it that way.

A card can say `kind: "format"`; a formatting proposal was reported as a
deletion labelled with the paragraph's own text. The popover describes it
through `formattedText` instead of rendering an empty replaced→inserted pair.
`FormatRenderInstruction` is exported, so a consumer can name the arm it
narrows to. The underline groups glyphs by `lineY`, so a run of mixed sizes
draws one straight rule rather than disjoint stubs.
