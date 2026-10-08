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

Selection survives the rewrite instead of being rebuilt from one endpoint. The
replayed transaction already carries it — ProseMirror maps it as each replay
step applies — so a range stays a range, a backward selection stays backward,
and whatever kind it was it stays. Per-step mapping also survives what a single
composed mapping cannot: a structural step's undo-and-restamp, which is why
wrapping or indenting no longer walks the caret backwards by a wrapper depth.
The caret is overridden only to follow an insertion, and only when the gesture
left a caret, so it can no longer collapse a range the gesture left standing.
Deciding which step produced that caret compares the step's result range with
the selection in one document frame, replacing a five-position proximity guess.

The replay's bridge, which maps the source document it has reached into the
replayed one, is now advanced by every step kind rather than only by a replace;
each tracker begins by inverting its source step, so that is one rule, and
`TrTrackingContext` declares the field instead of having it written behind the
type's back.

A tracked change uses the representation its schema allows. Inserting a block
that admits no marks — a code block — is recorded on the node alone; marking its
text built content the node type rejects, and because `create` does not
validate, the document stayed broken until a later transaction touched that node
and threw somewhere unrelated.

Tracking is all-or-nothing. A gesture is checked before the replay touches
anything and is either recorded in full or refused in full, so the document can
no longer hold an edit with only part of it reviewable. What makes a gesture
refusable is whether the replay can represent every one of its steps — size is
not a tracking failure, and a document-wide formatting command, which emits one
step per block, is tracked in full however many blocks it spans. The outcome is
readable as `TrackingResult` on plugin state (`lastTracking`), carrying step
count and elapsed time as diagnostics; acting on a refusal — undoing the edit,
warning the author — is the host's decision.
