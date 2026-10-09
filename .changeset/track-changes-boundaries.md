---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

Commands answer whether they ran. `editor.commands.*` and `runCommand` returned
`void` while the ProseMirror commands underneath them already returned a
boolean, so a caller had no way to tell a refusal from a no-op — which is how a
blocked Accept could look like a dead button. Read-only now reports `false` like
any other refusal rather than returning nothing.


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
replayed transaction already carries it, mapped forward through the replay, so a
range stays a range, a backward selection stays backward, and whatever kind it
was it stays. Deriving it instead by inverting the gesture's own steps and then
crossing the replay bridge sent the position backwards through a structural
step's undo-and-restamp, which has no interior position left to land on — that
is why wrapping or indenting walked the caret backwards by a wrapper depth.
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

Reviewing is answerable. `reviewChanges` carries out a decision and returns what
actually happened, and `planReview` says what a decision would take without
doing it — a preview, never proof that execution succeeded. A refusal names its
own reason (`dependent-changes`, `missing-changes`, `not-permitted`,
`invalid-result`), because only the first can be resolved by deciding more and
offering that for the rest would propose work nobody asked for.

React decides through one shared action (`useReviewAction`), so every Accept and
Reject in the panel and the popovers ends the same way: the decision is carried
out, or the surface that was clicked says what stopped it — per-change on the
card, and for Accept all and Reject all beside the buttons themselves. Previously a blocked decision returned
`false` into a caller that discarded it, so the button did nothing and said
nothing. Dependent work is listed rather than counted, and is only decided after
a second explicit confirmation that replans first — if more work came to depend
on the change in the meantime, the wider set is shown before anything is
decided, not after.

Tracking no longer treats a doc-attribute write as untrackable. Page and section
settings go through `tr.setDocAttribute`, and doc attributes are not tracked
content, so a gesture carrying one is tracked for its content and reported as
tracked. A refusal also outranks a sibling success: one dispatch can carry
several transactions, and the last of them no longer reports on behalf of all.

Review validates the spans its own steps rewrote, taken from the steps rather
than from their position maps. Review does most of its work with marks, whose
maps are empty, so a map walk validated nothing for accepting an insertion or a
deletion.

`MAX_TRACKED_STEPS_PER_TR` is gone from the public surface along with the
`step-budget-exceeded` refusal it named; `TrackingRefusal` now reports
`unsupported-step` or `duplicate-transform-package`.

`planReviewIn` is the one place that answers whether a state permits a decision
and what carrying it out would take; the command, the host preflight and the
plugin's own gate all ask it instead of deriving it separately. A decision the
gate refuses is reported rather than dropped.

`TrackChangesState` names the plugin state a host reads off
`trackChangesPluginKey`, replacing a stale three-field copy of it that described
the state as it was several fields ago. The React notice is
`ReviewRefusalNotice`, which no longer collides with the plugins type of the
same name, and it takes `className`/`itemClassName` and themes through the
package's own `--scrivr-react-*` tokens like its siblings.
