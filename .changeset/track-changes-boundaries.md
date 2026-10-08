---
"@scrivr/plugins": patch
---

Track changes keeps its boundaries: editing content that already holds
suggestions no longer destroys authorship, selection, or unrelated decisions.

Deleting a pending insertion follows one ownership policy (`canCancelInsertion`)
shared by the text and node writers. A deletion cancels only an insertion this
author owns, and only while it owns every pending record it would erase —
deleting someone else's proposal preserves it and records a deletion alongside.
Node deletion used to find an insertion and remove the node without asking whose
it was, so one author could silently discard another's work.

An edit inside content inserted earlier in the same gesture is composed rather
than replayed blind. The author's own edits fold into the creation
(`creationId`); anyone else's record an existence dependency (`dependsOn`), and
`foldingClosed` keeps that boundary after the dependent work is reviewed. Moves
carry placement identity separately (`placementDependsOn`), so rejecting a move
transports current content and review identities back, including edits made
after it.

Review is planned before it is applied. `planChangeReview` is a pure preflight
that reports missing IDs and existence/placement dependencies; a blocked plan is
refused rather than silently widened, and the decision is evaluated on a private
transaction whose result must validate before any step is published.

Selection is carried across the rewrite instead of rebuilt from one endpoint.
Each selection kind maps itself, so a range stays a range, a backward selection
stays backward, and a cell selection stays a cell selection; an explicit caret
is remapped past content a tracked deletion retained rather than left on a stale
position. The caret only follows an insertion when the gesture left a caret —
it can no longer collapse a range the gesture left standing. Deciding which step
produced the caret now compares the step's result range with the selection in
one document frame, replacing a fixed five-position proximity guess.

A tracked change uses the representation its schema allows. Inserting or
deleting a block that admits no marks — a code block — is recorded on the node
alone; marking its text built content the node type rejects, and because
`create` does not validate, the document stayed broken until a later
transaction touched that node and threw somewhere unrelated.

Tracking refuses a gesture it cannot record in full. The step ceiling is checked
before the replay, and crossing it records nothing instead of leaving the
document edited with only part of it reviewable. The outcome is readable as
`TrackingResult` on plugin state (`lastTracking`); acting on a refusal — undoing
the edit, warning the author — is the host's decision.
