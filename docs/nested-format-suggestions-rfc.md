# Nested Format Suggestions RFC — a suggestion over another author's keeps it

Status: built on PR #265 (2026-11-17). See *What shipped*.

## Direction

Track changes is multi-author: a mark carries a list of records, each with its
author, and a reviewer decides each. Formatting that excludes its own kind — a
colour, a size, a font, a link — breaks that. Two values of one kind cannot
stand on the same text, so when Alice sets green over Bob's pending red, Bob's
suggestion has nowhere to stand and is lost: rejecting Alice's change returns
to the agreed colour, and Bob's proposal is never decided by anyone.

This RFC keeps every author's suggestion until someone decides it.

## Where we are

A tracked insert of an excluding mark records, in `replaced`, the agreed
formatting it took off, and rejecting it puts that back (#265). A suggestion it
took off is *superseded*: it gives back what it had replaced, and its own
record is dropped. Removing a pending suggestion withdraws it the same way.
Setting the value a text already shows changes nothing, so it already keeps
its author's records.

## 1. Decision — a change over another author's suggestion holds it

- **Another author's pending suggestion is kept, records and all.** Alice's
  green over Bob's pending red records `replaced: [red, with Bob's record]`.
  Bob's record still carries its own `replaced: [blue]`, so the chain is the
  history of proposals down to the agreed value.
- **Your own suggestion still folds.** Alice's green over Alice's own pending
  red is one proposal, blue → green: a later edit refines the author's own
  change, as typing inside one's own insertion does.
- **Removing another author's suggestion stacks.** Alice clearing Bob's
  pending red adds her delete record beside his on the same mark —
  `[Bob insert, Alice delete]`, the model a mark's record list already is. No
  value is invented and none is lost.
- **Agreed formatting is untouched by any of this.** It is still recorded
  untracked in `replaced`.

## 2. Decision — one rule settles a mark

Every decision about a formatting mark on text goes through
`settle(mark, decided)`, which returns the marks the text carries instead (a
node mark, on an image, keeps its own simpler path):

| Records decided | Result |
|---|---|
| a delete accepted | nothing: the value is gone, whatever else it carried |
| a delete rejected | the mark, without that record |
| an insert accepted | the mark, without that record |
| an insert rejected | what it replaced, each settled in turn, carrying the mark's undecided records |
| none | the mark as it is |

Settling is recursive. Rejecting Alice's green restores Bob's red; if Bob's
record is decided in the same review it is settled at once, so "reject all"
returns the agreed value in one pass, at any depth. It is also
order-independent: a mark is settled once from every decision, not record by
record, which is what makes a stacked accept-delete and reject-insert agree
whichever is applied first.

## 3. Decision — a held suggestion is listed and decidable

`findChanges` lists a suggestion held in `replaced` as a mark change of its
own, with `within` naming every change that holds it. A suggestion that still
shows somewhere on the text is listed there, once; its held copies are the same
record and are decided by the same id. It is reviewed like any other:

- **Decided with the holder** — settled as §2 says.
- **Decided alone, the holder still pending** — the holder's `replaced` entry
  is settled in place: accepting Bob's red makes it the agreed value Alice's
  change would restore; rejecting it leaves blue there. Alice's change is
  shown exactly as before.
- **Accepting the holder** discards what it holds: both cannot apply.

A decision can leave no place for an undecided suggestion — one held by an
accepted change, one on a mark whose removal is accepted, a removal over a
rejected suggestion that restores nothing. The plan finds these by settling
the marks as the review will, and lists them as rejected, so a host previewing
a decision sees every change it decides and the review never drops one
undecided.

A held change is not on the text. The popover never offers one at the caret,
leaves it out of conflicts, and gives a holder its `heldChanges`, so a host can
show "Alice: red → green, over Bob's blue → red". Acts never join a held piece
with one on the text.

## Non-goals

- **Nesting for marks that stack.** Bold over Bob's pending bold, or two
  highlights, can stand together and are already kept (§ *Where we are*).
- **Node and text changes.** Text and block suggestions have their own
  ownership rules (`creationId`, `dependsOn`); this RFC is the formatting lane.

## Invariants

- No pending record is dropped by another author's edit.
- Rejecting every pending change returns the agreed formatting; accepting
  every one returns what was shown — at any nesting depth, in one review.
- `settle` is the only place a formatting mark's decided records become marks,
  in review and in its preview alike.
- A record read from `replaced` is checked as any record from a saved
  document is: a malformed one is left out, never trusted.

## Tests

- Alice over Bob, each decision alone and together, both orders: the table
  in §2, and §3's decided-alone rows.
- Three authors deep: reject all, accept all, and the middle one alone.
- A removal over another's suggestion: accept or reject either record, alone
  or together.
- The seeded colour property with several authors over each other's
  suggestions: reject-all gives the original, accept-all the proposal, and no
  pending record is ever lost without a decision.
- Listing: a held change is listed `within` every holder; one shown anywhere
  is offered where it shows, and never joined into an act with a held piece.
- The preview names every change the review decides.

## What shipped

- `formatSuggestions.ts` holds the rule: what a suggestion keeps when it is
  recorded (`restoredOnReject`, `proposeRemoval`, `restoreRuns`) and what
  deciding it leaves (`settle`, `hasDecision`), with one `DecisionOf` type.
- Review settles every mark a decision reaches, anywhere in the document, once
  per pass. The plan settles a scratch copy the same way to find what a
  decision displaces, so preview and outcome cannot disagree.
- `findChanges` keeps held and shown pieces of an id apart, lists a held copy
  only when the record shows nowhere, and names every holder. The repair pass
  never rewrites a held piece onto the text.
- Found on the way, older than this RFC: `mergeTrackedMarks` fused neighbours
  by their last record only, dropping the rest of a mark carrying several
  records, and renamed other authors' ids. It now fuses only single records
  of the author writing. Cloning a document re-keys held records too.
- The semantic lane lists held suggestions and reads the agreed formatting as
  what the text had before.
- Not changed: core's sealing count reads top-level records only. A held
  record always has a pending holder, so sealing is still refused, but the
  count is lower than `findChanges` reports.
