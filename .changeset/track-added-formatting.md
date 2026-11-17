---
"@scrivr/plugins": patch
---

Formatting is tracked again on current ProseMirror. From prosemirror-transform 1.12.3, bold, colour or any other added mark landed untracked: recording it threw, and the error was only logged.

A colour, size, font or link set over another now remembers the agreed one it replaced. Rejecting it puts that back, where before the text was left with none. The change popover offers it as `replacedMarks`, and `getRichBlocks` lists it in the change's `oldAttrs`. Text that had different values becomes one change per value.

Setting a value the text already shows changes nothing, so another author's suggestion stays theirs. Setting the agreed value back proposes nothing. A different value set over a pending suggestion supersedes it, and rejecting returns to the agreed value. Text whose formatting a review settled joins its neighbours again. Saving a link with its own address, or with a new one through `setLinkHref`, no longer proposes removing the link. Taking off a pending suggestion, by hand or by an agent, withdraws it and proposes removing the agreed value under it. Marks set and taken off within one transaction are recorded against what the text had before it. An agent's edits through `applyRichDiffAsSuggestion` follow the same rules, so rejecting them never accepts a suggestion they were made over.
