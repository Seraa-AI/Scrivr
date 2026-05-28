# AI Authoring and Private Proposal Model

## Contract

AI-generated proposals are private until the user commits them.

While a user is reviewing AI output, other collaborators may continue editing the shared document and this client must continue receiving those remote updates. The user's AI proposals must not be broadcast as collaborative document updates, cursor positions inside private-only content must not leak, and undo/redo must not move content across the private/public boundary accidentally.

Commit is the explicit boundary. Before commit, AI work is local proposal state. After commit, the accepted work becomes a normal document transaction: either tracked changes or a direct edit.

## Author, not mode

`Editing`, `Suggesting`, and `Viewing` describe the human user's intent. AI describes provenance.

Do not make AI a fourth core `TrackChangesStatus` or collaboration mode. That creates ambiguous states like "human suggesting, AI suggesting" where the mode implies broadcast but the AI privacy contract forbids it.

Use AI as an author/provenance layer instead:

- Human editing remains `Editing`, `Suggesting`, or `Viewing`.
- AI proposals are authored as local AI work, for example `authorID: "ai-local"`.
- The UI may expose an "AI Workshop" or "AI Review" toggle, but that toggle is a workflow gate, not the load-bearing document mode.
- The AI Workshop UI must clearly say that AI suggestions are private until committed.

This keeps the human mode model stable while giving the editor a first-class place for local AI proposals, reviewer bots, named AI agents, and future provenance metadata.

## Current direction

The AI Toolkit should keep the overlay/proposal model: streaming and preview are cosmetic, and the shared document is untouched until accept/commit.

The next implementation work should extend that model instead of creating a forked local `Y.Doc`:

- Inserts: continue using ghost/proposal rendering.
- Deletes: add strikethrough/tombstone decorations.
- Replaces: render delete + insert as one proposal/card.
- Multi-block proposals: represent a proposal as a list of anchored decorations.
- Anchors: use durable node IDs plus mapped offsets where needed.

This covers the main workflow: "let AI draft a rewrite, review it, then accept block-by-block or commit the whole proposal." It intentionally does not optimize for typing inside the middle of a private AI draft before accepting. The simpler product rule is: accept first, then edit.

## Privacy boundary

The privacy boundary belongs at the sync/promotion surface, not in a second collaborative document.

The intended rule is:

```ts
if (transactionOrigin === "ai-local" || aiWorkshopActive) {
  applyLocally();
  doNotBroadcast();
} else {
  applyLocally();
  broadcast();
}
```

That is the principle, not a confirmed one-line implementation. Scrivr owns a custom `YBinding` in `packages/plugins/src/collaboration/YBinding.ts`, so the implementation needs an explicit audit before we rely on transaction-origin filtering.

### YBinding audit checklist

Before implementing private AI proposals through origin filtering, verify:

1. Transaction origins propagate through Scrivr's custom `YBinding` into Yjs transactions. The binding currently writes PM changes using `ydoc.transact(..., LOCAL_ORIGIN)`, so we need a way to preserve or classify AI-local origins instead of collapsing every local write into one origin.
2. Provider filtering happens at the right granularity. If multiple PM transactions are coalesced into one Yjs update, a per-transaction origin may not be enough.
3. Doc attrs and content share a sync transaction today. AI-private proposals must not accidentally broadcast private doc attrs or content-like markers.
4. The undo manager currently tracks `LOCAL_ORIGIN`. AI-private history must not merge with normal collaborative history.
5. Awareness is a separate channel. Document update filtering does not control cursor or presence broadcast.

The implementation target is still "filter at the sync boundary," but we should write the tests against the actual binding and provider behavior before committing to the API shape.

## Awareness policy

AI Workshop introduces a presence problem: the user's local selection may move inside private proposal content that does not exist for other collaborators.

Policy:

- Do not broadcast cursor positions inside private-only AI proposal content.
- Keep the collaborator-visible cursor pinned to the last valid shared anchor.
- Broadcast a separate awareness flag such as `mode: "ai-workshop"` or `activity: "reviewing-ai"` so other users understand why the cursor is not moving normally.

This gives collaborators a truthful signal without leaking private proposal positions or text.

The awareness schema needs to support this explicitly. `CollaborationCursor` currently writes `user` and `cursor` fields through provider awareness; AI Workshop should add a presence/activity field rather than overloading document updates.

## Undo history

AI Workshop needs isolated history.

Private AI proposal edits should not enter the same undo stack as normal user edits. Otherwise `Cmd+Z` can cross the privacy boundary: undoing private proposal changes after a commit, or undoing the commit in a way that appears to re-private already-shared content.

Policy:

- Opening AI Workshop starts a private history isolate.
- Private proposal changes undo/redo only within that isolate.
- Commit closes the isolate and replays the accepted result as one normal undoable transaction in the main document history.
- Reject/discard drops the private isolate without touching the shared document history.

The custom `YBinding` also owns a `Y.UndoManager` scoped to `LOCAL_ORIGIN`; that must be reviewed alongside ProseMirror history so AI-local work is not tracked as normal collaborative undo state.

## Persistence

`y-indexeddb` is not a privacy boundary.

It may be useful later to persist an AI Workshop session across reloads, but it should only restore private local proposal state. It must not be the mechanism that prevents sharing. Privacy comes from not broadcasting AI-local updates and only promoting proposals on explicit commit.

Offline behavior should be straightforward:

- AI Workshop can function offline because proposals are local.
- On reconnect, AI-local proposals remain local.
- Only explicit commit creates broadcast-eligible document updates.

## Promotion

Promotion is where private AI work becomes shared document state.

There should be two explicit commit paths:

### Commit as suggestion

Convert accepted AI proposals into normal tracked changes.

Open metadata decisions:

- The visible author could be the current human user, with AI provenance metadata.
- Or the visible author could be an AI author, such as `ai:claude`, with the human user recorded as the committer.

The important rule is that `ai-local` must not remain as a private-only author after promotion. Promotion should produce normal, broadcastable tracked changes.

### Apply directly

Apply accepted AI proposals as normal document edits.

This path should still preserve any audit/provenance metadata we decide is required, but it should not create tracked-change marks unless the user chooses that behavior.

## Anchors and stale proposals

Use cheap, explicit stale detection first.

Anchor proposals to stable node IDs from the UniqueId extension plus offsets/ranges mapped through ProseMirror transactions when possible. On commit, validate:

- The source node still exists.
- The source range still exists.
- The content under the source range has not materially changed.

If validation fails, mark the proposal stale and require regenerate, discard, or manual re-anchor. Do not attempt diff-against-diff rebasing in the first version.

## Non-goals for the first version

- No forked local collaborative `Y.Doc`.
- No branch rebase engine.
- No typing into private AI draft text as if it were committed document text.
- No use of `y-indexeddb` as a privacy guarantee.

If the overlay/proposal model later proves insufficient, the work above will still clarify what a branch/rebase model would need to preserve.

## Open questions

- What exact transaction-origin API should `YBinding` expose for AI-local work?
- Can the provider filter local Yjs updates before network broadcast without suppressing normal remote application?
- How should promoted AI suggestions represent visible author versus AI provenance?
- Should AI Workshop be globally available in all human modes, or gated when the document is view-only?
- What exact awareness field should collaborators see: `ai-workshop`, `reviewing-ai`, or a richer activity object?
- How do private AI proposals interact with export/import if a session is persisted locally but not committed?
