# RFC: Agent review views, structural staleness, and suggestion previews

Status: draft for sign-off (2026-11-10). Covers what is left of
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

`changes` are reported in both views, placed by offset into that view's text,
so an agent reading the original still sees what is proposed against it.

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

Nothing yet. Each phase updates this section as it lands.
