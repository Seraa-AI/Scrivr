# AI Authoring and Private Proposal Model

## Problem

Today the AI Toolkit surfaces proposals in a side panel. To review one, the user reads the panel item, finds the corresponding location in the document, mentally simulates the diff, then clicks accept. Two surfaces, cognitive overhead, slow review.

We want the proposal rendered **in the document** at the location it would land. The doc itself becomes the review surface. The panel becomes an optional overview, or goes away.

## Solution

Render AI proposals as canvas overlay decorations, indistinguishable from real edits, with inline accept/reject affordances. Until accepted, the proposal lives in plugin state — the shared document tree is unchanged.

This is the same primitive AI Toolkit already uses for ghost text (`GhostText.ts`) and tracked-change strikethrough (`TrackChanges.ts`). We extend it to cover deletes, multi-block replaces, and inline accept/reject affordances so the panel is no longer load-bearing.

## Invariant

**AI proposals never enter `editorState.doc` until the user commits.**

This single invariant makes the UX safe and makes every supporting concern below cheap:

- Nothing AI-local crosses `YBinding`, so collaborators never see proposals.
- No ghost cursors land in proposal-only text, because there is no proposal-only text in the shared model.
- Exports walk the doc only, so workshop sessions are naturally invisible to DOCX / PDF / Markdown.
- Undo of normal edits cannot cross the privacy boundary, because the boundary is the absence of doc mutation.

The invariant is enforced by construction: `AiSuggestionPlugin.ts` holds proposals in a `PluginKey<AiSuggestionPluginState>`, the overlay handler in `AiSuggestion.ts` reads `ps.suggestion.blocks` and paints, and only `applyAiSuggestion` in `showHideApply.ts` mutates `editorState.doc`.

## What stays the same

- **Track-changes status is the user mode model.** `TrackChangesStatus.enabled` (Suggesting), `TrackChangesStatus.disabled` (Editing), `TrackChangesStatus.viewSnapshots` (Viewing). AI is not a fourth mode. AI proposals render on top of whatever mode the user is in.
- **AI provenance is an author identity**, surfaced when AI work commits as tracked changes. It does not change how the user mode works.
- **`AiSuggestionPlugin` holds proposal state.** Overlay handler in `AiSuggestion.ts` paints it.
- **`applyAiSuggestion` is the only commit path.** Direct apply writes to the doc as a normal transaction; tracked apply writes `trackedInsert` / `trackedDelete` marks via the existing engine.

A visible "AI Review" toggle in the UI (collapse / expand proposals, jump to next pending) is a separate UX surface that does not need to be a mode. It is a view of the same underlying plugin state.

## What needs to be built (rendering)

Four concrete gaps between the current overlay system and the "panel goes away" target:

1. **Inline insert rendering.** Ghost text drawn at a position inside a block, not appended after the block. `GhostText.ts` is anchored to *after* a block today; for inline AI rewrites it needs to anchor to a position inside a block. `CharacterMap.coordsAtPos` already provides the pixel position.
2. **Inline delete rendering.** Strikethrough visible across all blocks by default, not only the active block. `AiSuggestion.ts:50` exposes `renderMode: "active-only" | "all" | "none"` — the default should become `"all"`, and the strikethrough needs to be rich enough to read as a diff at a glance.
3. **Inline accept/reject affordance.** A small widget anchored at the diff range — check / x icons, or a hover-card. Canvas overlay (rendered alongside the diff) or a DOM widget at `coordsAtPos`. DOM is probably cleaner for click interaction.
4. **Click-to-accept-then-place-cursor.** Clicking inside an inline insert (ghost text) or delete (strikethrough) accepts that op and places the caret at the click position. Without this, the user clicks on what looks like real text and the caret lands at the nearest real-doc position, which is confusing once the overlay looks like content.

## Interaction rules

- **Accept is always explicit.** Click the affordance, or use a defined keymap (e.g. `Cmd+Enter` accepts the proposal at the cursor's nearest pending op).
- **Typing does not implicitly accept.** Typing adjacent to a proposal must not accept it. The cursor is in real document text; typing edits that text. The proposal stays pending.
- **The cursor cannot land inside proposal-only content.** It lands in the surrounding real text. This falls out of the invariant — there is no PM position to land on.
- **Hover surfaces the affordance.** Hovering over an inline diff range shows the accept/reject controls. Without hover, the diff renders unobtrusively.

## Constraints the inline rendering creates

**Privacy** — enforced by the invariant. Proposals don't enter the doc, so `YBinding.targetObserver` never sees them, so `HocuspocusProvider` never broadcasts them.

**Awareness** — collaborators must not see ghost cursors landing in proposal-only content (already true: the cursor can't land there). When the user is actively reviewing AI work, broadcast a separate awareness field so collaborators understand why the cursor may be relatively idle:

```ts
awareness.setLocalStateField("activity", {
  kind: "ai-workshop",       // discriminator
  startedAt: 1716937200000,  // for "X has been reviewing AI for 5m" presence UI
});
```

While the activity is set, do not overwrite `awareness.cursor`. Do not delete it either — collaborators continue to see the user's last known shared-doc position.

**Undo** — accepted proposals replay as a single normal transaction in the main document history. Rejected proposals leave no trace because they never entered the doc. No special undo isolate is required — the invariant means there is nothing in the main history that crosses the privacy boundary.

**Export** — exporters walk `state.doc`. AI proposals are invisible to all current export paths (`exportDocx`, `exportToPdf`, `exportToMarkdown`) and to `BaseEditor.toJSON()`. Correct by construction; no exporter change required.

**Persistence** — to persist a review session across reload, the app serializes the suggestion separately: `{ doc: editor.toJSON(), aiSuggestion: ai.suggestions.getCurrent() }`. Restore via `editor.setContent(doc); ai.suggestions.show(aiSuggestion);`. Anchor mismatches surface through the existing `staleBlockIds` path in `AiSuggestionPlugin.ts`. A pair of `serializeWorkshopSession` / `restoreWorkshopSession` helpers (4–5 lines each) on `AiToolkitAPI` removes the boilerplate.

`y-indexeddb` is not a privacy mechanism. It may be useful later for crash recovery of an open session, but it stores Yjs updates locally regardless of who connected — the privacy comes from the invariant, not from where the bytes are persisted.

## Decisions

The following decisions were validated against the codebase on 2026-05-28.

### 1. Transaction-origin API on YBinding

`YBinding.ts:73` collapses every local write into a single `LOCAL_ORIGIN`, and `targetObserver` (line 241) runs `prosemirrorToYXmlFragment(currentDoc, this.type)` only when `prevDoc.eq(currentDoc)` is false (line 252). Because AI proposals don't mutate `editorState.doc` (invariant), `prevDoc.eq(currentDoc)` already returns true for AI-only state changes, and the broadcast naturally fires zero times.

**Decision:** no new origin API for v1. Rely on the invariant. If `editor.subscribe` is ever extended to pass the originating transaction, future per-write classification becomes possible without re-architecting the binding — but that work is not required to ship inline AI rendering.

### 2. Provider-level filtering

`HocuspocusProvider` ships outbound updates emitted by `ydoc.on('update', ...)` (constructed in `Collaboration.ts:128`). Inbound updates apply via `Y.applyUpdate(ydoc, update, "remote")` and surface on `YBinding.typeObserver`. The two directions are independent — filtering outbound does not block inbound.

**Decision:** provider filtering is feasible if ever needed, but unnecessary given the invariant. Mark as deferred; revisit only if AI-local content ever needs to enter `editorState.doc` while remaining private.

### 3. Visible author vs. AI provenance on promotion

`InsertDeleteAttrs.authorID` in `types.ts:54` is a single string. The track-changes color palette (`TrackChanges.ts:73-79`) keys on `authorID` and assigns distinct values to distinct slots, so two identities render with different colors automatically. `AiToolkit.ts:406` sets a `track-author` meta on `generateSuggestion`, but no code in `packages/plugins/src/track-changes/` reads it — the meta is dead.

**Decision:** composite `authorID` for v1 — `"ai:claude+user:raph"`. Single field, parseable, no schema change, no exporter migration. Adopt a separate `committerID` field later only if the audit story demands it. Either way, wire or delete the `track-author` meta so the comment in `AiToolkit.ts:365` stops lying.

### 4. AI review availability under read-only documents

Scrivr has two view-only paths: `editor.readOnly` (`Editor.ts:146, 332, 551`), which gates `InputBridge` and pointer interaction; and `TrackChangesStatus.viewSnapshots` (`types.ts:46`), which sets PM's `editable: false` via plugin props (`trackChangesPlugin.ts:34-36`). `AiSuggestionsAPI.show` (`AiToolkit.ts:49`) does not check either flag today.

**Decision:** allow the read-only side of the API under `editor.readOnly === true` — `compute`, `show`, `hide`, `getCurrent`, `reject`. Block the commit side — `apply` no-ops with a warning. AI review of a published or immutable document is a real use case; only the commit path needs write access. Add the `readOnly` check at the top of `applyAiSuggestion` in `showHideApply.ts:53`.

### 5. Awareness field shape

`CollaborationCursor.ts:48, 51-56` writes only `user` and `cursor` to awareness. The renderer at line 65-66 reads only those two keys. Awareness is a free-form `Map<string, unknown>` per client; adding fields cannot break existing consumers.

**Decision:** richer activity object under a single new field:

```ts
awareness.setLocalStateField("activity", {
  kind: "ai-workshop",
  startedAt: 1716937200000,
  promptSummary?: string,   // optional, app-controlled, default omitted for privacy
});
```

Discriminator extends to other non-broadcasting modes later (`"draft-revision"`, `"private-comment"`) without renaming.

### 6. Export and persistence

`BaseEditor.ts:301-302`: `toJSON()` returns `editorState.doc.toJSON()` — document tree only, no plugin state. All exporters walk the doc:

- `exportDocx` (`packages/docx/src/export/export.ts`)
- `exportToPdf` (`packages/export-pdf/src/`)
- `exportToMarkdown` (`packages/export-markdown/src/`)

AI proposals live in plugin state, so they are invisible to every export path and to `toJSON()`.

**Decision:** add `serializeWorkshopSession()` and `restoreWorkshopSession(envelope)` to `AiToolkitAPI` so apps have one documented shape for resume across reload. Implementation is the envelope already described in the Persistence section above.

## Non-goals

- No forked local collaborative `Y.Doc`.
- No branch / rebase engine.
- No typing into proposal-only text as if it were committed document text.
- No use of `y-indexeddb` as a privacy guarantee.
- No fourth user mode for AI.
- No mandatory side panel. Apps may still render one as an overview, but the in-document rendering is the primary surface.
