# RFC: Agent review views, structural staleness, and suggestion previews

Status: approved by the user on 2026-11-10, including D1–D8. Covers what is left of
[Scrivr#207](https://github.com/Seraa-AI/Scrivr/issues/207) (asks 3 and 4)
and the "previews for structural and rich edits" step of Seraa's plan 155.

Builds on, and does not repeat:

- [Tracked changes for agents](./tracked-changes-agents-docx-rfc.md): #207
  asks 1 and 2 shipped there as PR A (`suggestedInsert`, review records on
  nodes, the hash that moves when a reviewer acts).
- [Revision projection](./revision-projection-rfc.md): one revision-bearing
  document, several lenses (`accepted`, `rejected`), and Phase 5's hover
  preview.
- [Rich semantic editing](./rich-semantic-editing-rfc.md): semantic units,
  the edit protocol, structural ops.

## TL;DR

1. **A second view.** The semantic lane gains `view: "original"` beside
   `"proposed"`: the text as agreed before any pending proposal. It is the
   same document as the projection's `rejected` lens, built by one rule — which
   pending records a view leaves out. Agents read either; they edit only the
   proposed view.
2. **Structural ops get a stale guard.** Each op may carry the content hash of
   the unit it targets and of its anchor. A mismatch is reported `stale`, as a
   rich edit's is today. Two review-state refusals close the double-marking
   cases: deleting a block already proposed for deletion, and anchoring to one.
3. **Previews.** Text and inline formatting already preview. Block-level
   changes (alignment, heading level, list type) get a preview next, through
   the suggestion the overlay already draws. Structural previews (a block
   inserted, deleted, moved) need geometry for content that is not in the
   document, so they wait for the projection substrate and are drawn from a
   projected document, never by writing to the live one.

## Problem

### Agents can read only one view (#207 ask 3)

`SemanticTextView` is the single literal `"proposed"`
(`packages/core/src/exports/semantic.ts:40`): pending insertions in, pending
deletions out, with the deletions reported in `changes`. A reviewer working
mid-negotiation asks a different question — what did we agree before any of
this? — and the lane cannot answer it. An agent asked "summarise what this
clause said before the other side's changes" has to reconstruct the original
from `changes` itself, and gets it wrong for formatting and block attributes,
which `changes` describes but does not reapply.

### Structural ops have no stale guard (#207 ask 4)

A rich edit carries `expectedContentHash`; if the unit moved since the agent
read it, the edit is reported `stale` and nothing is written
(`packages/ai/src/ai-toolkit/AiToolkit.ts:581`). Structural ops carry no hash
(`packages/ai/src/ai-toolkit/applyStructuralEdits.ts:148-165`). They resolve an
id and act:

- `deleteBlock` on a block another author already proposed for deletion marks
  it a second time — two cards for one deletion, one of them the agent's.
- `insertBlock` or `moveBlock` anchored to a block proposed for deletion lands
  next to text that disappears on Accept, so the new block ends up beside
  whatever followed it.
- Any op computed before a collaborator edited its target or anchor applies
  to the edited content without anyone being told.

### Only text and inline formatting preview (plan 155)

`computeAiSuggestion` takes `proposedText` or `proposedSpans` per textblock
and the overlay draws the diff without touching the document
(`packages/ai/src/ai-suggestion/computeAiSuggestion.ts:25-40`). Everything else
an agent proposes — a heading level, alignment, a list type, an inserted or
deleted block, a move — is applied straight away as tracked changes. There is
no "show me first".

## Design

### 1. Views are which pending records a view leaves out

The walker already decides, per node and per run, whether the proposed view
leaves it out (`ctx.isRemoved`, `packages/export-semantic/src/context.ts:204`).
A view is that decision, made per record kind:

| Pending record | `proposed` | `original` |
|---|---|---|
| inserted text, inline object, block | in | out |
| deleted text, inline object, block | out | in |
| formatting change | the new marks | the marks before (`formattingChanges` already records them) |
| node attribute change | the new attrs | `oldAttrs` (already on `suggestedAttrs`) |
| move | at its destination | at its source |

**Built by the engine's reject (decided 2026-11-10).** The table above is
what the engine's own Reject does to each record kind. Rather than restate it
in every semantic handler — a second copy of reject semantics to keep in step
with the engine — the original view walks the document the engine's reject-all
produces, run on a copy. It is therefore correct for every record kind by
construction, and carries no `changes`: there is nothing pending left in it.
An agent reads what is proposed from the proposed view, which places each
change in its text.

This is the projection RFC's `rejected` lens applied to the semantic lane; the
proposed view is `accepted`. One rule, two readers: when `projectRevisions`
lands, the walker reads a projected document and this table becomes its
definition, not a second copy of it.

API: `toSemanticUnits(doc, { view })`, `ai.getRichBlocks({ view })`, default
`"proposed"` — nothing changes for a caller that does not ask. `view` is
already on every unit.

**Hashes are per view.** `unitRichHash` covers `view`, so a hash read in one
view never guards an edit in the other.

**Only the proposed view is editable.** An edit protocol unit whose `view` is
not `"proposed"` is refused with `reason: "wrong-view"`. Editing the original
would mean rewriting text other authors have already proposed changes to,
and replaying their proposals over it — a rebase the engine does not do, and
should not do silently.

### 2. Structural ops carry the hash of what they touch

Every structural op accepts the hashes it was computed against:

```ts
{ kind: "structural", op: "deleteBlock", nodeId, expectedContentHash? }
{ kind: "structural", op: "insertBlock", anchorNodeId, position, block, anchorContentHash? }
{ kind: "structural", op: "moveBlock", nodeId, anchorNodeId, position, expectedContentHash?, anchorContentHash? }
// and the list/table ops alike: target and anchor, each optional
```

The ops are `strictObject`s (`packages/ai/src/schema/edit.ts`), so the two
fields are added to their schemas, not passed through.

`applyStructuralEdits` compares each against `unitRichHash` of the live unit
holding that block, as the rich path does. A mismatch puts the op's id in
`result.stale` and writes nothing for it. Optional, so existing callers are
unchanged; `getRichBlocks` already returns the hash an agent should echo.

Two refusals, regardless of hashes, because they are about review state, not
staleness:

- **`deleteBlock` on a block already proposed for deletion** is reported in
  `result.alreadyProposed` and writes nothing. The deletion stands as its
  author proposed it.
- **An anchor proposed for deletion** refuses `insertBlock` and `moveBlock`
  with `reason: "anchor-proposed-for-deletion"`. The agent re-anchors to a
  live block; the engine does not guess which one the agent meant.

### 3. Previews come from the suggestion, or from a projected document

**Block-level changes (phase 2).** `computeAiSuggestion` blocks gain
`proposedAttrs` (heading level, alignment, indent, list type), the vocabulary
`applyRichEdit` already validates. The suggestion overlay draws them as
TrackChanges draws an attribute change — the change bar and a card line —
and applying the suggestion writes them as `suggestedAttrs`. Nothing about
the document changes until Accept, as today for text.

**Structural changes (phase 3).** A preview of an inserted block needs that
block laid out; a deleted block, the layout without it. That is geometry for
a document that does not exist, which is what the projection substrate
provides. A structural suggestion is held beside the document; its preview is
`projectRevisions` over the live document plus the suggestion's records, laid
out read-only, and drawn as revision geometry (projection phases 1, 3 and 5).
Accept writes the ops as tracked changes; dismiss drops the suggestion.

Rejected alternative: apply structural ops as tracked changes immediately and
reject them on dismiss. Every collaborator sees the "preview", it enters undo
history, and it breaks the invariant that a suggestion changes nothing until
it is accepted.

## Decisions

- **D1: The second view is called `"original"`.** *Recommended.* Word's name
  for the same thing. Alternative: `"accepted"` for the agreed baseline —
  rejected, because the projection RFC already uses `accepted` for the
  opposite lens.
- **D2: Only the proposed view is editable**; other views are refused with
  `"wrong-view"`. *Recommended.*
- **D3: `unitRichHash` covers `view`.** *Recommended.* NEW in the hash input.
- **D4: Structural hashes are optional**, target and anchor separately.
  *Recommended.*
- **D5: Deleting an already-deleted block is `alreadyProposed`, not a second
  record.** *Recommended.*
- **D6: An anchor proposed for deletion refuses the op**, rather than
  re-anchoring to the next live block. *Recommended*: the engine does not
  guess intent.
- **D7: Block-level previews ride on the suggestion overlay** (`proposedAttrs`).
  *Recommended.* NEW field on the suggestion block.
- **D8: Structural previews wait for the projection substrate** and never
  write to the live document. *Recommended.*
- **D9: A unit with pending changes keeps its markdown, rendered from the
  proposed view** (decided 2026-11-23, Seraa's ask S1). Until now the walker
  dropped `markdown` whenever a unit had `changes`. Serializing the live
  blocks would mix deleted text with inserted text, so an agent read a line
  with a pending change without its bold, italics or links, and a host
  rebuilt tables and headings itself.
  - **The rendered document:** the markdown comes from the document with every
    pending proposal accepted, by the engine's own Accept on a copy. This is
    the original view's Reject-all run the other way, so the two stay one
    rule.
  - **One copy per call:** each unit's blocks are found in that copy by id,
    and rendered through the unit's own node handler, so a table that
    declines GFM for merged cells still does.
  - **Only the unit's own words:** a unit gets markdown only where none of its
    blocks is proposed for deletion, and the copy holds every one of them
    reading as the unit does: the same `text` and the same inline objects,
    such as images. Otherwise it gets none. That covers:
    - a block proposed for deletion;
    - a move's old place, which shares its id with the new one;
    - a block a pending deletion joins to the next;
    - a block with no stored id.
  - **What stays the same:** `text`, `spans` and `changes` are unchanged, so
    the changes still say what is proposed and where. The markdown only reads
    as the proposal would.
  - **New contribution hook:** `proposedDocument`, beside `documentIn`. It
    supplies that copy and nothing else. It is separate because the proposed
    view's text is still read from the live document, where its changes can
    be placed.
  - **Alternatives rejected:**
    - CriticMarkup in the markdown: a second redline format beside `changes`.
    - Markdown rebuilt from `spans`: a second serializer, which loses
      structure such as tables and list markers.

- **D10: A host names the suggestion a change came from** (decided
  2026-11-23, Seraa's ask S5). Today the link from a tracked change back to the
  review row it was written for exists only in the host's database: Scrivr
  gives each change a fresh id, and the host records those ids. When the
  database and the document disagree — a write it could not record, a stray
  change a failed withdraw left, a retry — the document cannot say which row a
  change belongs to, and two edits by one agent look the same.
  - **`operationId`:** a host passes it when it writes a suggestion
    (`applyAiSuggestion`, the suggestion lanes, `AiToolkit.applyRichEdit` /
    `applySemanticEdits`, or `trackAsSuggestion` directly). The engine stores
    it on every record that suggestion writes, through the same base attrs the
    author travels in, and the semantic export shows it on each change.
  - **Changes from different suggestions never fuse.** Two adjacent changes by
    one author with different operation ids stay two records and two acts.
  - **NEW record field, not `groupId`:** `groupId` already means one phrase's
    replacement, so deciding one decides its other half; a suggestion has
    many phrases.

## Phases

1. **Views and the structural guard** — design §1 and §2. One PR across
   export-semantic and ai. No new dependency.
2. **Block-level previews** — design §3, first half. ai only.
3. **Structural previews** — design §3, second half. After revision
   projection phases 1 and 3; hover preview (projection phase 5) is the same
   mechanism.

Columns, also on plan 155's later list, is its own RFC
([columns](./columns-rfc.md)) and is not part of this one.

## What shipped

### Phase 1 — views and the structural guard

- **The original view** — `toSemanticUnits(editor, { view: "original" })` and
  `ai.getRichBlocks({ view: "original" })`. As decided above, it walks the
  document the engine's reject-all leaves, supplied by TrackChanges through a
  new `SemanticHandlers.documentIn(doc, view)`; its units carry `view:
  "original"` and no `changes`. Without TrackChanges, or with nothing pending,
  it is the document itself. `getRichBlocks` keeps its `(from, to)` form
  beside the new options object.
- **D2** — `applyRichEdit` reports a unit read in another view under a new
  `wrongView` list and writes nothing for it.
- **D3** — `unitRichInput` covers `view` only when it is not `"proposed"`, so
  every existing proposed-view hash is unchanged.
- **D4** — `expectedContentHash` (target) and `anchorContentHash` (anchor) on
  the structural ops' schemas. `applySemanticEdits` judges them against the
  document as the agent read it, before any op of the batch runs, by the
  top-level unit holding the block; a stale op writes nothing and its id is in
  `stale`.
- **D5, D6 — deviation.** #207's double-marking was already closed before
  this phase: an id that resolves only to content proposed for deletion was
  refused, inside the generic `rejected`. This phase names the reasons apart:
  `alreadyProposed` for a delete's target, `anchorProposedForDeletion` for an
  anchor. One existing test moved its anchors from `rejected` to the new list.

### D9: markdown of the proposed view (2026-11-23)

- A unit with pending changes keeps `markdown`, rendered from the document
  Track Changes' `proposedDocument` supplies: its own Accept of every pending
  change on a copy, sharing one function with the original view's Reject.
- The walker builds that copy once per call, and only when a unit with
  changes asks for it.
- A unit's blocks are found in the copy and must read as it does, with the
  same text and inline objects, and none may be proposed for deletion. So a
  deletion, a move's old place (even an image or a rule, which have no text) or
  a pending join never gives a unit another unit's words or images. The unit's node handler renders them, so a table with
  merged cells still has none.
- Without a contribution that supplies the document, or if supplying it fails,
  a unit with changes has none, as before. Markdown is a convenience, so a
  fault there does not fail the export.
- The unit hash does not cover `markdown`, so no pinned hash goes stale.

### Records without their timestamps (2026-11-23, Seraa's ask S3)

- A tracked change whose record lacks `createdAt` or `updatedAt`, as a stored
  or converted document may carry it, was left out of the change set until
  the next edit repaired it. So the proposed view applied it from its marks
  while the original view, which undoes what is pending, kept it.
- The change set now counts a record by its identity (id, author, operation,
  status). The two views, review and act grouping read the same pending
  changes from the moment the document is loaded. The next edit still fills
  in the timestamps.
- That repair now touches only the record it repairs:
  - a block record with no operation is dropped alone;
  - two records on one mark keep their own ids;
  - a split's reference record is stamped too, so the repair does not run on
    every edit.

### D10: the suggestion a change came from (2026-11-23)

- `operationId` is stored on every tracked record a suggestion writes when the
  host passes one, carried by the same base attrs as the author, and shown on
  each change in the semantic export. Records with different operation ids
  never fuse, and their formatting pieces are never one act.
- It is accepted by:
  - `trackAsSuggestion(tr, authorID, { operationId })`;
  - `applyAiSuggestion`;
  - `applyDiffAsSuggestion`, `applyMultiBlockDiff` and
    `applyRichDiffAsSuggestion`;
  - `AiToolkit.applyRichEdit` and `applySemanticEdits`, which cover text,
    structural and image-layout changes.

### Next release cycle (decided 2026-11-10)

Kept out of this release so it is not held:

- **The suggestion lanes record through the engine.** Four lanes
  (`applyDiffAsSuggestion`, `applyRichDiffAsSuggestion`, AI suggestion apply,
  `insertAsSuggestion`) write tracked marks by hand instead of making plain
  edits under `trackAsSuggestion` for the step trackers to record. That second
  copy of the engine's rules knew only text; the review found its gaps. This
  release closes the ones it opened — plain lanes write no breaks, a rich insert
  is one act and withdraws its breaks — and leaves the rest: a rich edit cannot
  yet propose deleting an existing break (`splitRangeForNewMark` marks text
  only), and the plain lanes read no breaks.
- **Phase 2, block-level previews** — not blocked.
- **Phase 3, structural previews**, on the revision-projection substrate
  (projection by the engine's own accept/reject, its mapping as the bijection,
  an editor lens), as proposed on 2026-11-10.

