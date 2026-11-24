# Track Changes Follow-ups RFC — closing what #228's review left open

Status: proposed (2026-11-24); phases 2 and 3 are done, as *What shipped*
records. Answers parts 1, 3, 4 and 5 of #232. Part 2 was answered by the
[overlapping steps RFC](./overlapping-steps-rfc.md) (#257).

**Answer:** each part closes in its own PR, stacked on this one:

- **Part 1:** run the six review checks in the playground and record what they
  show. Anything that misbehaves becomes its own issue.
- **Part 4:** a test named for a fix has to fail without that fix. Any test that
  can't is renamed as a regression guard.
- **Part 3:** a struck block stays movable. The shape that breaks review is
  moving a *move shadow*, the old place a move leaves behind. Tracking refuses
  that gesture when it is made.
- **Part 5:** the planners get names that say what they take, the engine's
  verdicts reach plugin state by a path no host can write to, and three engine
  functions are renamed to what they do now.

## Question

#232 asks for four things here:

1. **Part 1:** click review through in a real browser, and file anything that
   misbehaves.
2. **Part 3:** decide whether a block already proposed for deletion should be
   movable, and if not, refuse the move when it's made.
3. **Part 4:** make each listed test fail without its fix, or rename it as a
   regression guard.
4. **Part 5:** fix three planner names, two public messages a host can forge,
   and three engine names that have outgrown what they do.

## Where each part stands on main

#232 was written against #228's branch. Main has moved on since (#265, #277,
#278, #283 to #286), so each part was checked again on main at `867d7e24`.

| Part | What the issue says | What main does now |
|---|---|---|
| 1 | The panel and popover have never been clicked in a browser | Still true |
| 3 | Rejecting a move of a struck block fails with `invalid-result` | True only for a move shadow (see Part 3) |
| 4 | Several tests also pass against main's plugin code from before #228 | One test name has changed, so the list is fixed again (see Part 4) |
| 5 | Three planner names, two public messages and three engine names mislead | Still true. All eight are unchanged |

## Part 1: review in the playground

Run each of the six checks in the issue in the docs playground, with Track
Changes on, in a real browser:

1. Conflict
2. One card
3. Paragraph break
4. Two moves
5. Dependent work
6. Undo

**Recorded in this RFC.** Each check gets a line in *What shipped*: pass, or the
issue raised for it. A failure is filed as its own issue with the steps to
reproduce it, as #232 asks, and is not fixed in this stack. That keeps this
stack to what #232 asked for, and lets a fix get its own review.

**No code.** The part 1 PR changes only this RFC, so it carries `no-release`.

## Part 4: tests that prove their fix

The rule: **a test named for a fix must fail without that fix.** A test that
passes either way is a regression guard, and its name says so.

**How each test is judged.** The fix the test names is reverted in place on
current main, and the test is run against that revert. A whole older commit is
not checked out, because the API has changed since #228 and the old code would
not run today's tests.

- **Fails without the fix:** it proves the fix, and stays as it is.
- **Passes without the fix, but the test can be made to fail:** it is
  tightened.
- **Passes without the fix, and no tightening makes it fail:** it is renamed
  "guards against …".

**The tests.** These are the issue's list, with names and lines as they were on
main before phase 3, which renamed five of them and tightened one (see *What
shipped*):

| File | Tests |
|---|---|
| `trackingRefusal.test.ts` | "stops a step kind the replay has no tracker for" (line 65), and the `it.each` of straddling steps (line 79). Together they replace the issue's "records nothing when it refuses": each asserts a refused edit leaves nothing pending |
| `compositionContract.test.ts` | "keeps a second author's edit made inside a move's shadow" (line 197), "names that edit before accepting the move takes the shadow away" (line 206), and "requires shadow edits before rejecting a %s move" (line 225, one test per direction) |
| `trackedRepresentation.test.ts` | "stamps a deleted block that admits no marks on the node, not its text" (line 56), and "still marks text where the schema admits marks" (line 65) |
| `selectionContract.test.ts` | All 12 tests. The issue estimates about 7 of them don't prove their fix |

**Tests only.** No package code changes, so this PR carries `no-release`. The PR
lists each test with its verdict and the revert used to reach it.

## Part 3: moving a block that is already struck

**Two kinds of struck block.** A block is struck either because it is proposed
for deletion, or because it is a move shadow: the old place a move leaves
behind, which the code calls a shadow (`isMoveShadow`, `moveShadowRanges`). They
behave differently when moved.

Each case below was run on main with one transaction that deletes the block and
inserts it at the top. That's what the review property test does, and it's what
`Editor.moveNode`, the drag path, builds.

| Moved | Result |
|---|---|
| A block proposed for deletion | Recorded as a move. Accepting the move leaves it struck at its new place. Rejecting the move puts it back in its old place, still struck. Checked with one author and with two |
| A move shadow | A third copy of the block. Accept all works. Reject all fails with `invalid-result`: "Cannot resolve the live identity and original placement of this move" |
| Two blocks, the second a move shadow | Same as the row above |
| A move shadow, deleted rather than moved | Accept all and reject all both work |

The second row reproduces with one author and three paragraphs. It is seed 203
of `reviewProperty.test.ts`, run with struck blocks allowed.

**Why the shadow fails.** The moved copy carries the shadow's own deletion
record, as well as its new move record. Rejecting the first move then finds two
deletions for one move, so it can't tell which copy is the block
(`engine/moveIdentity.ts:76-79`).

**Decision: a block proposed for deletion stays movable. Moving a move shadow is
refused when the gesture is made.**

- **A proposed deletion is still the block.** Its text is there, and the move
  reviews correctly both ways. Moving it is ordinary editing, so refusing it
  would take away a gesture that works.
- **A move shadow holds nothing to move.** The block already lives at its new
  place, and the shadow only marks where it came from. Moving it makes a third
  copy, and review can no longer tell which copy is the block.
- **Refused when made, not at review.** Tracking stops the gesture with a new
  refusal, `{ reason: "moved-move-shadow" }`, as it stops `overlapping-steps`.
  The edit never lands, so nothing waits to fail later at review.

**How it is recognised.** This is a new check. It combines two things the engine
already does:

- **The pairing** in `groupMoveSteps`, which pairs a whole-block deletion with
  the insertion of the same content.
- **A pending deletion record carrying a `moveNodeId`**, which is how
  `normalizeMoveShadows` (`engine/moveIdentity.ts:54`) finds a shadow.
  `isMoveShadow` doesn't check status, so it isn't reused as it is.

The gesture is refused when any top-level node in the paired deletion is a move
shadow. Checking only the first node would miss the two-block row above. The
nodes moved are the ones tested, not what they contain. A list that is itself a
shadow is found by the walk at its own level.

**Where it goes.** In `gestureRefusal` (`engine/trackChanges.ts:80`), run on the
split gesture. `filterTransaction` and `suggestionBlocked` both consult it, so an
agent that asks first is told the move would be refused. It also goes in the
check during replay (`engine/trackChanges.ts:131`), so the engine never writes
such a move whatever path it arrives by.

**Out of scope: a clipboard cut and paste.** That is two transactions, paired
only after the paste applies (`lib/cutAndPaste.ts`), so a check made at the
gesture can't see the pair. Phase 4 adds a test first:
- If cutting a move shadow and pasting it reviews correctly, the test stays as a
  guard.
- If it fails, it gets its own issue.

**Tests, written first:**

- **Fail on main:**
  - The refusal, for one block and for two.
  - Its reason reaches `onRefused`, and `suggestionBlocked` returns it.
  - `describeSuggestionRefusal` has wording for it.
  - `reviewProperty.test.ts` stops skipping struck blocks. Its editor gets
    `onRefused`, because a refusal made before the edit applies never sets
    `lastTracking`. It expects a move shadow's move to be refused, and every
    other struck block's move to review.
- **Already pass, so named as guards:**
  - Moving a block proposed for deletion, then accepting or rejecting the move.
  - Deleting a move shadow, then reviewing.
  - Cutting a move shadow and pasting it.

**Release.** `patch` for:
- `@scrivr/plugins`: the new reason is a new member of the exported
  `TrackingRefusal` union.
- `@scrivr/react`: the wording, from `@scrivr/react/track-changes`.

A host that maps every reason exhaustively, as React does
(`packages/react/src/utils/suggestionRefusal.ts:9`), has to add this one. The
changeset says so.

## Part 5: names and the public surface

### The three planners

| Today | Takes | What it adds | New name |
|---|---|---|---|
| `planReview` | an editor | read-only, then everything below | `planReview` (unchanged: it is the one hosts call) |
| `planReviewIn` | an `EditorState` | permission, and the formatting suggestions a decision displaces | `planReviewOfState` |
| `planChangeReview` | a `ChangeSet` | nothing: the pure check | `planReviewOfChangeSet` |

`planReview` keeps its name because it is the default a host reaches for. The
two names that change are the ones that hide what they take. The doc comment of
`planReviewOfChangeSet` says it is the narrower check, so the two aren't
mistaken for each other.

**No aliases.** The old names are removed, with a **Breaking** note in a patch,
as `setHeading1` to `setHeading6` were. Every release here is a 1.0.x patch, so
an alias "until the next minor" would never be removed. Every caller in the repo
moves to the new names.

### The engine's verdicts

`TrackChangesAction.reviewResult` and `TrackChangesAction.trackingResult` carry
the engine's verdict from `appendTransaction` into plugin state. Because they're
on a public enum, a host can set them and forge `lastReview` or `lastTracking`.

**Making the key private isn't enough.** A meta key is a string, so a host can
write it by name, and a `PluginKey`'s string can be predicted.

**Decision: no meta at all.** The plugin writes its verdicts to a `WeakMap` keyed
by the transaction it creates, and `apply` reads them back from there. The map
is private to the engine, and no host can put an entry in it.
- **Typed:** the map holds `{ review?: ReviewOutcome; tracking?: TrackingResult }`,
  with one typed function to write and one to read. There is no `getMeta` and no
  cast.
- **The early return:** `apply` returns early when a transaction changes nothing
  and carries no action (`engine/trackChangesPlugin.ts:217`). It must also check
  the map, or a blocked review, which changes nothing, would never publish its
  outcome.
- **Reading is unchanged:** a host reads `lastReview` and `lastTracking` from
  plugin state, as it does today.

**Breaking, deliberately:**
- The two members leave `TrackChangesAction`.
- They leave the exported `TrackChangesActionParams`, and so `getAction` and
  `setAction`.
- The exported `hasAction` stops counting them.

Nothing in this repo outside the engine uses them.

**Tests, written first, failing on main:**
- A host that sets `"track-changes-review-result"` or
  `"track-changes-tracking-result"` doesn't change `lastReview` or
  `lastTracking`.

**And one guard:**
- A blocked review, which changes nothing, still publishes `lastReview`.

### The engine functions

These three aren't exported, so renaming them changes no API. Their names
describe what each function used to do.

| Today | What it does now | New name |
|---|---|---|
| `fixAndSetSelectionAfterTracking` | carries the selection through the replay, and re-selects a node written back | `carrySelectionThroughReplay` |
| `deleteTextIfInserted` | removes the author's own pending insertion where it may be withdrawn, and otherwise strikes text not already struck | `deleteOrStrikeText` |
| `updateChangesStatus` | carries out a review plan and returns its outcome | `executeReviewPlan` |

The issue says the first one "now only places a caret". The code still carries a
range or a selected node through, so the new name says that.

Each file is renamed with its function. Every importer moves with it, along with
the comments that name it: `types.ts`, `reviewViews.ts`, the engine, and the
tests.

**Release.** `patch` for `@scrivr/plugins`, with a **Breaking** note for the old
planner names, the two members and `hasAction`.

## Phases

Each phase is its own PR, stacked on the one before. #257 answered part 2 before
this naming began, so this stack starts at phase 1.

| Phase | Branch | Into | Work | Release |
|---|---|---|---|---|
| 1 | `track-changes-232-phase-1` | `main` | This RFC | `no-release` |
| 2 | `track-changes-232-phase-2` | phase-1 | Part 1: the playground checks, recorded here | `no-release` |
| 3 | `track-changes-232-phase-3` | phase-2 | Part 4: each test proves its fix, or is renamed a guard | `no-release` |
| 4 | `track-changes-232-phase-4` | phase-3 | Part 3: refuse moving a move shadow | `patch` (plugins, react) |
| 5 | `track-changes-232-phase-5` | phase-4 | Part 5: names, and verdicts off the public enum | `patch` (plugins) |

The playground checks come first. A bug found there gets its own issue, and that
issue can be weighed before the code phases.

## Non-goals

- **Fixing what the playground turns up.** Each failure gets its own issue.
- **Making a move shadow movable.** Review would have to tell three copies apart,
  and no gesture a person needs depends on it.
- **Refusing a move shadow cut and pasted across two dispatches.** The phase 4
  test decides whether that needs anything.
- **Renaming exported types** such as `ReviewPlan` and `TrackingRefusal`. The
  issue doesn't ask for it.

## Alternatives considered

- **Refusing every struck block (part 3).** It's simpler, but it takes away
  moving a proposed deletion, which reviews correctly today.
- **Letting review resolve a move shadow's move (part 3).** That would mean
  inventing which of three copies is the block. The engine fails closed today
  rather than guess.
- **Deprecated aliases for the old planner names (part 5).** No release would
  ever remove them, and they leave two names for one function.
- **A private meta key (part 5).** A host can still write the string.
- **Checking who set the meta (part 5).** A transaction can name an author, but
  only one it declares itself, so checking it proves nothing.

## Questions a reviewer will ask

- **Why do the playground checks get their own PR when they change no code?**
  The results are worth reviewing, and an issue raised there can change the
  order of the later phases.
- **Is `invalid-result` still reachable after part 3?** Only if the engine
  breaks one of its own invariants. It stays the engine's fail-closed answer, and
  nothing is written.
- **Why not keep the old planner names working?** In this repo, a rename in a
  patch is announced as Breaking, as other renames have been. An alias that is
  never removed is a second name to maintain.

## What shipped

### Phase 2: the playground checks (2026-11-24)

The checks were run by hand in the docs playground, in a browser. Each failure
is filed as its own issue. Two were reproduced in a test against main (#297,
#298); the other two were found in the code (#299, #300).

| Check | Result | Issue |
|---|---|---|
| 1. Conflict | Pass. Both buttons complete, and one undo restores the conflict | |
| 2. One card | Pass. One card, the badge says 1, and rejecting it removes the whole paragraph | |
| 3. Paragraph break | Pass, in two clicks. Rejecting both cards restores the text, but the Changes panel has no Reject all to do it in one | #300 |
| 4. Two moves | Pass. No text lost or duplicated | |
| 5. Dependent work | Partly. It asks before rejecting. But each typed key counts as its own dependent change ("8" for " details"), Alice's card shows the typed word as part of her addition, and the notice is unreadable in the dark theme | #297, #299 |
| 6. Undo | Partly. The first undo brings the accepted change back to pending. The second removes the word one letter at a time, however fast it was typed | #298 |

**Causes:**

- **#297: each key is its own change.** This happens inside a paragraph another
  author inserted. Each typed key is merged with the one before it as soon as
  it is written, but the merge needs both to depend on the same creation, and
  `dependsOn` is stamped only afterwards, by `composeGestureRecords`. So the key
  before already depends on Alice's paragraph, the new one doesn't yet, and they
  never merge. In an ordinary paragraph neither depends on anything, and the
  keys merge into one change.
- **#298: one undo, one letter.** With tracking off, keys typed under 500 ms
  apart undo as one step, which is the editor's rule (`newGroupDelay`). Keys
  further apart undo one at a time, by the same rule. With tracking on, even
  keys 10 ms apart undo one at a time. The replay takes the typed character out
  and writes it back marked. Mapped through those two steps, the range history
  keeps for the last key comes out empty and is dropped, so the next key is
  never adjacent to it and starts a new undo step.
- **#299: unreadable notice.** The notice's text uses `--scrivr-react-text`,
  which the dark theme makes light. Its background `--scrivr-react-notice-surface`
  is set nowhere, so it stays at its light fallback, `#fdf6e7`. The playground's
  `TrackChangesInspector` reads the same unset variable.
- **#300: no Reject all.** Accept all and Reject all exist only on the AI
  suggestion cards.

### Phase 3: tests that prove their fix (2026-11-24)

Each fix was reverted in place on main, one at a time, and the tests run
against it.

**Prove their fix.** These fail with the revert:

| Test | Reverted |
|---|---|
| `trackingRefusal`: "stops a step kind the replay has no tracker for", and the `it.each` of 8 straddling steps | `filterTransaction` no longer asks `gestureRefusal`, so the edit lands |
| `compositionContract`: "names that edit before accepting the move takes the shadow away" | the planner no longer links a move to its shadow (`pairedMove`) |
| `compositionContract`: "requires shadow edits before rejecting a forward / backward move" | rejecting a move no longer consumes its shadow (`removesContent`); the `pairedMove` revert fails them too |
| `selectionContract`: "keeps a range selecting the same text…", "keeps a backward range…", "carries a range that spans the tracked edit", "never collapses a range the gesture left standing" | a range collapses to a caret, as before #228 |
| `selectionContract`: "remaps an explicit caret past content the deletion retained" | an explicit caret is left where it was, not mapped through the replay, as before #228 |
| `selectionContract`: "lands after the replacement…", "keeps typing after a replacement in one run…" | the selection is not carried through the replay at all |
| `selectionContract`: "leaves a caret alone when the edit landed somewhere else" | the caret always follows the insertion, as before #228 |
| `selectionContract`: "keeps a caret in the middle of the text it wrapped" | a wrap is written back instead of re-applied as a wrap |

**Tightened.** "preserves a node selection" passed with every revert, because
its edit was far from the selected block. It now deletes the block before the
selection, and is renamed "keeps a node selection on its block when the block
before it is deleted". It fails when the node selection is mapped as before
#228.

**Guards.** No revert in Scrivr fails these, and no tightening found one that
would, so each is renamed "guards against …":

| Was | Now | Why no fix stands behind it |
|---|---|---|
| `compositionContract`: "keeps a second author's edit made inside a move's shadow" | "guards against losing a second author's edit made inside a move's shadow" | Text typed into a shadow's unmarked text is a plain insertion with or without #228 |
| `trackedRepresentation`: "stamps a deleted block that admits no marks on the node, not its text" | "guards against marking the text of a deleted block that admits no marks" | ProseMirror's `addMark` already skips text whose parent admits no such mark |
| `trackedRepresentation`: "still marks text where the schema admits marks" | "guards against leaving text unmarked where the schema admits marks" | It checks the schema fix doesn't go too far. The fix's own test is the inserted-block one, which fails without it |
| `selectionContract`: "keeps the caret at the end of the text it wrapped" | "guards against moving the caret away from the end of the text it wrapped" | A caret at the end of the wrapped text survives a written-back wrap too |
| `selectionContract`: "lands after typed text" | "guards against the caret landing anywhere but after typed text" | The code before #228 put the caret after typed text the same way |

Of `selectionContract`'s 12 tests, 10 now prove their fix and 2 are guards. The
issue estimated that about 7 didn't prove theirs.
