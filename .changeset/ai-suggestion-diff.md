---
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

A small AI edit in a long paragraph is that edit, its new words keep the text's formatting, and a call that names a paragraph twice no longer garbles it.

- **`diffText` sets the words shared at each end aside first** (#254). The comparison and its size guard then see only the part that changed. Before, past 20,000 comparison cells a paragraph was deleted and written out again, even for a one-word fix, and its formatting was lost. When the changed part itself is past the guard, it alone becomes one deletion and one insertion.
- **New words in a plain-text proposal take formatting as typing does in Word.** A replaced word takes the formatting of the text it replaces. An insertion takes the formatting of the text before it, or after it at the start of a paragraph, leaving out marks that do not grow at their edge, such as a link. This applies to `applyDiffAsSuggestion`, `applyMultiBlockDiff` and `computeAiSuggestion`'s plain proposals, and the preview shows what the apply writes. Proposals given as formatted runs are unchanged. `plainProposalMarks` is exported for hosts that diff on their own.
- **A paragraph named more than once in one call is left alone and reported** (#282). `applyMultiBlockDiff` returns it in a new `rejected` list (`MultiBlockDiffResult`), and `applyRichDiffAsSuggestion` in its existing one. The rest of the call still applies.
- **Suggesting mode no longer crashes on an insertion of exactly two runs mid-paragraph**, such as a bold word followed by plain text. It was misread as a paragraph break.
