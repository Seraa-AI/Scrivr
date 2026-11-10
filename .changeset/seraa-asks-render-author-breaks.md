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
- **Hard breaks survive an agent's rich edit.** A `"\n"` an agent writes in a
  rich edit is the block's line break, as the semantic export reads one:
  `spansToFragment` builds the schema's line-break node (a newline in a code
  block, a space where the schema has none), and `applyRichDiffAsSuggestion`
  records it like any insert. One insertion is one change, breaks included, and
  restating the original withdraws it. Before, an added break became a space.
  The plain-text lanes (`applyDiffAsSuggestion`, `insertAsSuggestion`, AI
  suggestion apply) read a block without its breaks, so they still write
  `"\n"` as a space.
- **Formatting survives a paste in suggestion mode.** Adjacent runs with
  different formatting no longer merge under the first run's marks
  (`equalMarks` compared a node with itself).
