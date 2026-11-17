---
"@scrivr/plugins": patch
---

Formatting is tracked again on current ProseMirror. From prosemirror-transform 1.12.3, bold, colour or any other added mark landed untracked: recording it threw, and the error was only logged.

A colour, size, font or link set over another now remembers the agreed one it replaced. Rejecting it puts that back, where before the text was left with none. The change popover offers it as `replacedMarks`, and `getRichBlocks` lists it in the change's `oldAttrs`. Text that had different values becomes one change per value.

Setting a value the text already shows changes nothing; setting the agreed value back proposes nothing. Saving a link with its own address, or with a new one through `setLinkHref`, no longer proposes removing the link. Taking off your own pending suggestion withdraws it and proposes removing the agreed value under it. Marks set and taken off within one transaction are recorded against what the text had before it. An agent's edits through `applyRichDiffAsSuggestion` follow the same rules. Text whose formatting a review settled joins its neighbours again.
