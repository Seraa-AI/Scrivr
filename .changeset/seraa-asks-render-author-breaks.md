---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

Three asks from hosts building their own review UI on suggestions.

- **Turn off the change colours.** `TrackChanges.configure({ renderMode: "none" })`
  paints no tracked changes on the canvas; they are still recorded, reviewed
  and exported. `AiToolkit.configure({ aiSuggestion: { renderMode: "none" } })`
  passes the suggestion overlay's options through; `aiSuggestion: false` still
  leaves it out.
- **A suggestion keeps its author.** `computeAiSuggestion` puts the `authorID`
  it is given on the suggestion, and applying it records text and formatting
  changes by that author. Before, every applied suggestion was by
  `"ai:assistant"` whatever author it was computed for.
- **Hard breaks survive an agent's edit.** A `"\n"` an agent writes is the
  block's line break, as the semantic export reads one: `spansToFragment`
  builds the schema's line-break node (a newline in a code block), and the
  suggestion paths (`applyRichDiffAsSuggestion`, `applyDiffAsSuggestion`,
  `insertAsSuggestion`, tracked AI apply) record it like any insert, so
  rejecting the suggestion takes it back. Before, an added break became a
  space.
