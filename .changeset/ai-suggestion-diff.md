---
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

A small AI edit in a long paragraph is that edit, its new words keep the text's formatting, and a call that names a paragraph twice no longer garbles it.

- **`diffText` sets the words shared at each end aside first** (#254). The comparison and its size guard then see only the part that changed. Before, past 20,000 comparison cells a paragraph was deleted and written out again, even for a one-word fix, and its formatting was lost. When the changed part itself is past the guard, it alone becomes one deletion and one insertion.
- **New words in a plain-text proposal take formatting as typing does in Word, and kept text proposes none.**
  - A replaced word takes the formatting of the text it replaces.
  - An insertion takes the formatting of the text before it, or after it at the start of a paragraph or a line.
  - A mark that does not grow at its edge, such as a link, carries only into the inside of a run that has it.
  - This applies to `applyDiffAsSuggestion`, `applyMultiBlockDiff`, `computeAiSuggestion`'s `proposedText`, and an `AiToolkit` rich edit given as text without `spans`, which before proposed removing every mark on the kept text.
  - Proposals given as formatted runs are unchanged.
  - Exported for hosts that diff on their own: `plainProposalMarks`, `plainTextSpans` and `acceptedMarksAt`, the one reader of each accepted character's formatting.
- **Formatting is read the same way everywhere a proposal is compared.** It counts a line break and leaves out a mark another author proposed removing. Before, a proposal over a paragraph with a line break, or beside a pending unformat, showed formatting changes nobody had proposed. Rebasing a partly applied suggestion was off by one after a line break.
- **A paragraph named more than once in one call is left alone and reported** (#282).
  - `applyMultiBlockDiff` returns it in a new `rejected` list (`MultiBlockDiffResult`), and `applyRichDiffAsSuggestion` in its existing one.
  - `computeAiSuggestion` leaves it out and tells a new `onWarn` option.
  - An id no block has is not counted as repeated: `applyRichDiffAsSuggestion` reports it in `notFound`, and `applyMultiBlockDiff` and `computeAiSuggestion` skip it.
  - The rest of the call still applies. `namedMoreThanOnce` is exported.
- **Suggesting mode no longer crashes on an insertion of exactly two runs mid-paragraph**, such as a bold word followed by plain text. It was misread as a paragraph break.
