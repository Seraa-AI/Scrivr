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

Every decision about a mark goes through `settle(mark, decisions)`, which
returns the marks the text carries instead:

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
own, `within` the change that holds it, over that change's range. It is
reviewed like any other:

- **Decided with the holder** — settled as §2 says.
- **Decided alone, the holder still pending** — the holder's `replaced` entry
  is settled in place: accepting Bob's red makes it the agreed value Alice's
  change would restore; rejecting it leaves blue there. Alice's change is
  shown exactly as before.
- **Accepting the holder** discards what it holds: both cannot apply.

A held change is not an overlap. Review's dependency and conflict logic, and
the popover's conflict grouping, skip `within` changes; the popover shows a
holder with what it holds: "Alice: red → green, over Bob's blue → red".

## Non-goals

- **Nesting for marks that stack.** Bold over Bob's pending bold, or two
  highlights, can stand together and are already kept (§ *Where we are*).
- **Node and text changes.** Text and block suggestions have their own
  ownership rules (`creationId`, `dependsOn`); this RFC is the formatting lane.

## Invariants

- No pending record is dropped by another author's edit.
- Rejecting every pending change returns the agreed formatting; accepting
  every one returns what was shown — at any nesting depth, in one review.
- `settle` is the only place a mark's decided records become marks.
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
- Listing: a held change is listed `within` its holder, not as a conflict.

## What shipped

- `settle` (`helpers.ts`) is the one place decided records become marks; review settles every
  mark a decision reaches (`applyChanges`), whatever change brought it there.
- `restoredOnReject` holds another author's pending work whole and folds the author's own;
  `proposeRemoval` stacks a removal on another author's mark.
- `findChanges` lists held suggestions with `within`; the planner treats a holder and what it
  holds, and records on one mark, as settled together rather than overlapping work.
- What a decision leaves no place for — held by an accepted change, or on a mark a decision took
  away, at any depth — is reported rejected with it. Anything else gone undecided still fails
  the review's identity check.
- Found on the way: `mergeTrackedMarks` fused neighbours by their last record only, dropping
  the rest of a mark carrying several authors' records. Such marks are no longer fused.
- The popover never offers a held suggestion at the caret, leaves it out of conflicts, and
  gives a holder's `heldChanges`.
