---
"@scrivr/plugins": patch
---

Formatting is tracked again on current ProseMirror. From prosemirror-transform 1.12.3, bold, colour or any other added mark landed untracked: recording it threw, and the error was only logged.

A colour, size, font or link set over another now remembers the agreed one it replaced. Rejecting it puts that back, where before the text was left with none. The change popover offers it as `replacedMarks`, and `getRichBlocks` lists it in the change's `oldAttrs`. Text that had different values becomes one change per value. Setting the agreed value back proposes nothing. Clearing a pending recolour proposes removing the agreed colour, rather than dropping it. Changing a link's address with `setLinkHref` is one change that restores the old address. Two values set in one transaction leave the later one standing. An agent's recolour through `applyRichDiffAsSuggestion` follows the same rules, so rejecting it never accepts a suggestion it was made over.
