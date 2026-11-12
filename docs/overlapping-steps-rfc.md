# Overlapping Steps RFC — which gestures tracking still stops, and why that can stay

Status: Draft (2026-11-12). Answers part 2 of #232. Nothing here changes how a
package behaves; it adds tests that keep the answer true.

## Question

#232 part 2 asks about a gesture whose later step writes both inside what the
same gesture inserted and outside it. Its example: insert `abc`, then delete a
range starting inside it and ending past it. Tracking refused that with
`overlapping-steps`, the edit stayed in the document unrecorded, and no
reviewer could decide it. The issue asks:

1. Does any real command or AI op produce this shape?
2. If one does, split the straddling step at the insertion's edge.
3. If none does, say so and close this part.

## What changed after the issue was written

#232 was opened on 2026-11-05. #228 (`a395c98`) landed on 2026-11-08 and
answered most of it:

- **The issue's example is now split and recorded.** `splitAtInsertionEdges`
  (`track-changes/engine/composeGesture.ts`) cuts a straddling deletion, or an
  inline replacement within one block, at the insertion's edges. Inside, the
  step takes back the author's own text; outside, it proposes deleting what was
  there. `reviewBoundaries.test.ts` covers it ("splits a step straddling the
  insertion's edge").
- **A refused edit no longer lands unrecorded.** The plugin's
  `filterTransaction` asks `gestureRefusal` before the edit applies and stops
  it. The host hears why through `onRefused`, and `@scrivr/react`'s
  `describeSuggestionRefusal` turns `overlapping-steps` into words: make the
  edit in two steps, or decide your suggestion first.

## What is still refused

`splitAtInsertionEdges` returns null, and the gesture is stopped, when:

| Shape | Why it is not cut |
|---|---|
| The cut would fall between blocks: a gesture inserts a paragraph, then deletes from inside it into the next one | Cutting there would take an inserted block apart |
| The straddling replacement carries blocks, or an open slice | Its content would have to land on both sides of the cut |
| An inline replacement spans two blocks | The new text cannot stay where the original step put it once the range is cut |
| The straddling step is not a `ReplaceStep`, e.g. a wrap or lift whose tokens fall on both sides of the edge | Only replace steps are cut; formatting steps and `setNodeMarkup` are composed instead |

## Who builds these

Nothing in Scrivr does. We checked two ways.

**Measured.** We temporarily logged every straddle `composeGesture` found, and
every refusal, while the plugins, `ai` and `react` suites ran. The suites
include `trackedGestures.test.ts`, which runs real key bindings, commands,
paste, cut and drag with tracking on and off.

- 152 straddles. 148 came from six `trackedGestures` scenarios, and all six
  build the transaction by hand (`insertText(…).delete(…)`, `insert(…).delete(…)`).
  The other four came from the same kind of hand-built transaction in
  `reviewBoundaries.test.ts` and `trackingRefusal.test.ts`.
- Every one was split and recorded. There were no `overlapping-steps` refusals.
- No key binding, command, paste, cut, drag or agent edit produced a straddle.

**Read.** Each place that builds a transaction with more than one step:

| Source | What it builds | Straddles? |
|---|---|---|
| Input rules (`Heading`, `CodeBlock`, `List`, `HorizontalRule`, `Typography`) | One replacement, or a deletion then a wrap or block type | No insertion is written over later |
| Table row and column commands | One insertion or deletion per row or cell | Each lands beside the others |
| `Editor.moveNode` (drag) | Delete, then insert | The insertion is the last step |
| `ClearFormatting` | Mark removal, block types, then lists flattened back to front | Each flattened list lands beside the next |
| Paste placeholders | Attribute changes and deletions | No insertion |
| `CellSelection.replace` (typing, Delete, cut, paste over cells) | Each cell emptied to a new paragraph, then the content written into the first | The write lands inside the new paragraph, so it is folded into the insertion |
| `applyRichEdit`, `AiSuggestion` | Tracked marks built by hand, under `skipTracking` | Never reaches `composeGesture` |
| `applySemanticEdits` structural batch | One tracked transaction | `overlapsBatch` and `insideMoved` refuse an op on what the batch already added or moved. A block the batch inserts has no id until after dispatch, so no later op can name it |
| Image layout edits | `setNodeMarkup` | No insertion |
| Collaborator edits, history, normalization | — | Not tracked |

`CellSelection.replace` is the only built-in gesture that inserts and then writes
next to that insertion in the same transaction. `trackedGestures` did not
cover it. We ran typing, Delete, cut and pasting one and two lines over
selected cells: no straddles, every edit tracked, and Reject all returned
the original document.

## Decision

1. **Close part 2.** No command or agent edit builds a shape tracking stops.
   Only a host's own hand-built transaction can.
2. **Keep stopping those.** The edit never applies, the host is told why, and
   the user is told to make it in two steps. Cutting between blocks would take
   an inserted block apart. That would add risk to the replay for a shape
   nothing builds.
3. **Add tests so the answer stays true:**
   - `trackedGestures` gains six gestures over selected cells: typing (with
     content and with the first cell empty), Delete, cut, and pasting one and
     two lines. If a change to `CellSelection.replace` made them straddle where
     no cut is possible, the tracked run would be stopped and these scenarios
     would fail. Checked: with every multi-step gesture forced to refuse, all
     six fail.
   - `trackingRefusal` pins the three refused shapes a transaction can build:
     the document is unchanged, `onRefused` reports `overlapping-steps`, and
     nothing is pending. Checked: with gestures let through, all three fail.

## Non-goals

- #232's other parts: the playground pass (1), moving a struck shadow (3),
  tests that do not prove their fix (4), and API naming (5).
- Changing the refusal's wording, or what `onRefused` carries.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Cut at block edges too | Takes an inserted block apart. Nothing builds the shape, so the code would have no user |
| Record the straddling step as a separate change | The replay restores an insertion wholesale, so later work inside it has to be part of the insertion, not a change of its own (`GestureComposition`) |
| Let the edit through unrecorded | Someone suggesting must not change the text directly. #228 stopped this on purpose |

## Questions a reviewer will ask

- **Does the issue's own example still refuse?** No. #228 splits it, and
  `reviewBoundaries.test.ts` covers it.
- **What does a host see if it builds one of these?** The transaction does not
  apply, and `onRefused` receives `{ reason: "overlapping-steps" }`. The edit is
  stopped in `filterTransaction`, before tracking records anything.
- **Is "no straddles in the suites" enough?** Not alone. The suites only run
  what they contain, so we also read every multi-step transaction builder (the
  table above) and added the one built-in gesture `trackedGestures` lacked.
- **Why not take the cell selection gestures by keyboard?** A cell selection
  comes from the pointer. The tests restore one from its saved JSON
  (`scrivr:cell`), as a reload does.

## Release

Empty changeset ("No release"). Docs and tests only. No package behaves
differently.

## Files to create / modify

- `docs/overlapping-steps-rfc.md`: this RFC
- `.changeset/overlapping-steps-rfc.md`: the empty changeset
- `packages/plugins/src/track-changes/__tests__/trackedGestures.test.ts`: six
  gestures over selected cells, and `selectCells`
- `packages/plugins/src/track-changes/__tests__/trackingRefusal.test.ts`: the
  three refused shapes
