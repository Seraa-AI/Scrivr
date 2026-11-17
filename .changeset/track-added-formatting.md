---
"@scrivr/plugins": patch
---

Formatting is tracked again on current ProseMirror. From prosemirror-transform 1.12.3, bold, colour or any other added mark landed untracked: recording it threw, and the error was only logged. A recolour, resize or font change now also remembers what it replaced: rejecting it puts the old colour, size or font back (before, the text was left with none), the change popover offers it as `replacedMarks`, and the semantic lane reads it as the text's formatting before the change. An agent's recolour through `applyRichDiffAsSuggestion` is one change that restores the same way, where it used to cancel itself out.
