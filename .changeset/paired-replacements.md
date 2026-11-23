---
"@scrivr/plugins": patch
"@scrivr/react": patch
---

A word typed over a selection in suggesting mode is now one change, as Google Docs shows it. The deleted words and the typed words share a `groupId`, so the popover shows one card and deciding either half decides both.

New: the reader picks how a replacement is reviewed. `TrackChanges.configure({ replacementView })` sets the initial view and the `setReplacementView(view)` command switches it. `"paired"` (the default) is one card for the replacement. `"split"` shows the deletion and the insertion as two cards, each decided on its own, as Word does. The pairing is recorded either way, so switching never rewrites the document. `changeActs` and `planChangeReview` take the view, the change popover and `useTrackChangesPanel` (`@scrivr/react`) follow it, and the plugin state carries `replacementView`.

- Text the same writer types right beside the replacement's typed words, or retypes inside them, joins it. The same writer means the same author and, when a host names one, the same suggestion (`operationId`).
- Any other edit beside it, earlier or later, stays its own change, and so does another replacement, even side by side.
- Typing over text already struck, or over the writer's own pending insertion, starts no replacement: there is no new deletion to pair.
- Pasting paragraphs over a selection, or typing over one that spans paragraphs, is not paired: it also splits or joins paragraphs.
- Moved text is not paired; a move already pairs its two halves.
