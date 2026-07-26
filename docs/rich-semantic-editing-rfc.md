# RFC: Rich Semantic Editing & the `@scrivr/ai` package

Status: draft (2026-07-07)

## Problem

We want an AI agent to **read** a document with its formatting and structure, and
**write** edits back that preserve everything it didn't touch — landing as
tracked-change suggestions a human accepts or rejects. The read half exists
(`@scrivr/export-semantic`: `SemanticUnit` with `spans`/`attrs`/`cells`). The
write half is the missing bridge.

The first attempt at the write half took a wrong turn, and it failed loudly.

**What broke.** The merge addressed a whole *top-level block* and reconstructed
structure from a flattened, `\n`-joined string. Editing a ~48-block NDA produced
**814 tracked changes** (`575 trackedInsert + 238 trackedDelete`) for what should
have been a handful. Root cause: **two independent derivations of a block's
text** that had to agree byte-for-byte, and didn't:

- What the agent *saw* (`getRichBlocks` → `toSemanticUnits`) uses the semantic
  emitter, which recurses into containers and joins nested block text with `\n`,
  and turns hard breaks into `\n`. A list reads as `"item one\nitem two"`.
- What the merge *diffed against* (`buildAcceptedRichMap`) walked only a block's
  **direct** text children. For a list node those children are `listItem`s, not
  text — so it saw `""`.

A **verbatim echo** of a list therefore diffed `"item one\nitem two"` against
`""` → the entire list churned into insert + delete. Multiply by every list,
table, and hard-break in the document and you get 814.

The instinct to "just make the merge recurse and re-join like the emitter" —
inventing synthetic doc positions for the `\n` separators — makes the number go
away but is the wrong model. **Editing a document tree through a flattened string
channel is lossy**: a list's meaning is "an ordered set of item blocks," not "a
string with newlines in it." And it forces two text derivations, in two
packages, to be kept byte-identical by hand forever.

This RFC replaces that model, and extracts the AI surface into its own package so
we have a clean place to build on.

## Direction

Two independent moves that together fix the problem and set up the future:

1. **Leaf-based semantic editing.** The editable surface is the **leaf
   textblock** addressed by its stable `nodeId`. Structure (lists, tables) stays
   read-only *context*; changing structure is a separate, explicit operation type.
2. **A new `@scrivr/ai` package.** Extract `AiToolkit` + the AI-suggestion
   overlay out of `@scrivr/plugins` into `@scrivr/ai`, and make it the home of the
   semantic edit protocol, with **zod schemas as first-class, published API** so
   any consumer can validate agent output.

## Non-goals (this RFC / Phase 1)

- **Structural editing** — creating, deleting, moving blocks, list items, or
  table rows/columns. Specced here (§ Edit protocol) but built in later phases.
- **Changing `SemanticUnit.text` embedding semantics.** The flat text projection
  is correct for retrieval and stays exactly as it is.
- **Merged-cell table geometry edits.** Rejected until a later phase rather than
  risk corrupting a table.
- **A semantic AST.** We are not turning `SemanticUnit` into a second ProseMirror.

## The core insight

Every editable leaf **already has a stable, depth-agnostic `nodeId`.**

`planBlockIdAssignments` (`packages/core/src/model/assignBlockIds.ts`) walks
`doc.descendants` and stamps any block node that declares a `nodeId` attr at *any
depth*. `Paragraph` and `Heading` declare it; `tableCell` content is `block+`
(paragraphs); list items wrap paragraphs. So the paragraph inside a list item and
the paragraph inside a table cell each carry a durable `nodeId`, and
`findNodeById` (`packages/core/src/extensions/built-in/UniqueId.ts`) resolves it
by walking descendants.

Consequences:

- A leaf is **genuinely flat**, so a flat `InlineSpan[]` is the *correct* type for
  it — no structure to smuggle through `\n`.
- The merge maps a leaf to **one contiguous run of real doc positions** — one
  derivation, no recursion, no synthetic separators, no cross-package lockstep.
- Editing inside a list item or a table cell is identical to editing a paragraph:
  address the leaf by `nodeId`, diff its real text, apply.

Positional addressing (`itemIndex`, `rowIndex`, tree paths) is **rejected** for
inline edits: indices drift under insert/delete/collab, competing with the stable
id. Positional anchors return only for *creating* a node that doesn't exist yet
(structural ops), where the anchor is a nearby existing `nodeId`.

## Principles / invariant

1. **One shape per job.** `SemanticUnit` is a *read/embedding* projection (flat is
   fine for a vector). Editing needs *structure + identity + real positions*. Do
   not force one shape to serve both.
2. **Edit the leaves**, by `nodeId`.
3. **Structure is not text.** Lists/tables are read-only context; restructuring is
   a separate op type, never faked with newline diffing.
4. **The agent never emits document mechanics** — no PM positions, indexes, or
   slices. It emits semantic intent against `nodeId`s; a deterministic adapter
   converts to PM transactions; track-changes makes them reviewable.
5. **Validate everything with zod.** Agent output is untrusted; it is parsed and
   validated before it can touch the document.

> **Invariant.** Rich text edits target existing editable textblocks by `nodeId`.
> Structural edits target stable `nodeId` anchors and are translated into
> schema-valid PM transactions by the editor adapter. The AI never emits document
> positions, indexes, or PM slices.

## Data model

`SemanticUnit` stays flat for embedding; editable leaves are exposed as `parts`.
A unit has EITHER `spans` (it *is* a leaf) OR `parts` (it is a container). `cells`
stays as table **geometry** (gridSpan/vMerge/header) for render/DOCX — read-only,
the merge never touches it. `parts` is the universal edit surface.

```ts
interface SemanticUnit {            // existing read/embed fields unchanged
  // id, nodeIds, type, breadcrumb, order, text, attrs, cells, changes …
  spans?: InlineSpan[];             // present only when the unit IS a leaf
  parts?: SemanticPart[];           // present for container units (list, table)
}

interface SemanticPart {            // an editable leaf inside a container unit
  nodeId: string;                   // THE address — stable, depth-agnostic
  type: "paragraph" | "heading" | "codeBlock";
  breadcrumb: string[];             // location as CONTEXT only, e.g. ["Pricing","item 2"]
  text: string;
  spans?: InlineSpan[];
  attrs?: Record<string, unknown>;
}
```

A `list` unit, concretely — flat text for embedding, addressable leaves for
editing:

```jsonc
{ "id": "l1", "type": "list", "text": "Basic tier\nPro tier",   // untouched, for retrieval
  "parts": [
    { "nodeId": "li1p", "type": "paragraph", "breadcrumb": ["Pricing","item 1"], "text": "Basic tier" },
    { "nodeId": "li2p", "type": "paragraph", "breadcrumb": ["Pricing","item 2"], "text": "Pro tier" }
  ] }
```

## Edit protocol

A discriminated union, **zod-first** (`z.infer` is the source of truth for the
types). Phase 1 ships `RichSemanticEdit`; the structural ops are specced now so
the seam is stable, and built in later phases.

```ts
type SemanticEdit = RichSemanticEdit | StructuralSemanticEdit;

interface RichSemanticEdit {        // Phase 1 — inline text/marks/attrs on a leaf
  kind: "richText";
  nodeId: string;                   // resolves via findNodeById to any leaf textblock
  spans?: InlineSpan[];
  attrs?: Record<string, unknown>;
  expectedContentHash?: string;     // stale guard (per-leaf rich hash)
}

// Phases 2-5 — each op uses a nearby nodeId anchor + position: "before"|"after";
// never an index or PM position.
type StructuralSemanticEdit =
  | { kind:"structural"; op:"insertBlock"; position:"before"|"after"; anchorNodeId:string; block:SemanticBlockInput }
  | { kind:"structural"; op:"deleteBlock"; nodeId:string }
  | { kind:"structural"; op:"moveBlock"; nodeId:string; position:"before"|"after"; anchorNodeId:string }
  | { kind:"structural"; op:"insertListItem"; position:"before"|"after"; anchorNodeId:string; item:{ spans:InlineSpan[]; attrs?:Record<string,unknown> } }
  | { kind:"structural"; op:"deleteListItem"; nodeId:string }
  | { kind:"structural"; op:"moveListItem"; nodeId:string; position:"before"|"after"; anchorNodeId:string }
  | { kind:"structural"; op:"insertTableRow"; position:"before"|"after"; anchorNodeId:string; cells?:SemanticCellInput[] }
  | { kind:"structural"; op:"deleteTableRow"; anchorNodeId:string }
  | { kind:"structural"; op:"insertTableColumn"; position:"before"|"after"; anchorNodeId:string; cells?:SemanticCellInput[] }
  | { kind:"structural"; op:"deleteTableColumn"; anchorNodeId:string };

interface SemanticBlockInput { type:"paragraph"|"heading"|"codeBlock"; attrs?:Record<string,unknown>; spans?:InlineSpan[]; level?:number }
interface SemanticCellInput  { attrs?:Record<string,unknown>; spans?:InlineSpan[] }
```

**Bad vs good** (why anchors, not paths):

```jsonc
// BAD — a generic document-mutation language the model must get exactly right
{ "op":"insertNode", "parentPath":[0,2,1], "index":4, "node":{ "type":"listItem", "content":[…] } }

// GOOD — a semantic editor command against a stable anchor
{ "kind":"structural", "op":"insertListItem", "position":"after", "anchorNodeId":"li2p",
  "item":{ "spans":[{ "text":"Enterprise tier","marks":[] }] } }
```

Everything ships as **zod schemas** so any consumer — the playground AI route,
Seraa, third parties — can `Schema.safeParse(agentOutput)` and get validated,
typed edits. Primitive schemas (`InlineSpanSchema`, `InlineMarkSchema`) are
defined once and reused.

## Merge semantics (leaf-based)

`applyRichDiffAsSuggestion` (in `@scrivr/plugins/track-changes`) operates on a
**single leaf textblock**:

- `buildAcceptedRichMap` is the simple leaf walk — the block's own text nodes,
  hard break → `\n`, real doc positions. **One derivation.** No recursion, no
  synthetic separators, no cross-package lockstep. (This deletes the
  `collectAccepted` machinery added on the failed branch.)
- **Guard:** if `findNodeById(nodeId)` resolves to a **non-textblock** (a list or
  table container), reject the edit and surface it via `onWarn` — never flat-edit
  a container.
- **Keep** the `mergeTrackedMarks` extension (adjacent formatting-mark grouping —
  fixes a real live-editing bug where bolding two adjacent words made two changes)
  and `coalesceKeeps`. Both are correct and unrelated to the flattening mistake.

`@scrivr/ai`'s `applyRichEdit` is the semantic driver: resolve the target leaf,
per-leaf auto-diff + stale guard via a leaf rich hash (`unitRichHash` over
`{text, spans, attrs}`), then call the track-changes engine with zod-validated
edits. Structural edits (later phases) dispatch through a deterministic adapter
that emits schema-valid PM transactions, represented as tracked suggestions
(delete+insert fallback first; first-class `CHANGE_OPERATION.*_node` later).

## Package architecture — `@scrivr/ai`

Extract a new published package `@scrivr/ai` from `@scrivr/plugins`. It is the AI
layer and the place to "build upon" — `AiToolkit`, the AI-suggestion overlay, the
semantic edit protocol, and the zod schemas.

**Moves in** (behavior-preserving):

- `packages/plugins/src/ai-toolkit/*` — `AiToolkit`, `AiToolkitAPI`,
  `getAiToolkit`, `GhostText`, `AiCaret`, `aiToolkitRegistry`, tests.
- `packages/plugins/src/ai-suggestion/*` — `AiSuggestion` overlay,
  `computeAiSuggestion`, `showHideApply`, `subscribeToAiSuggestions`,
  `createSuggestionPopover`, render helpers, types, tests.

**Stays in `@scrivr/plugins/track-changes`** (Decision D1): the tracked-merge
engine — `applyDiffAsSuggestion`, `applyRichDiffAsSuggestion`,
`buildAcceptedTextMap`, `diffText`, `mergeTrackedMarks`, the `dataTracked`
helpers/marks. These are deeply coupled to track-changes internals. They become
**public exports** of `@scrivr/plugins`; `@scrivr/ai` imports them from the
package's public API, not deep paths.

**Dependency graph (acyclic):**

```
@scrivr/core
  ← @scrivr/export-semantic
  ← @scrivr/plugins   (track-changes, collaboration, header-footer, …)
  ← @scrivr/ai        (ai-toolkit, ai-suggestion, semantic-edit, zod schemas)
                      deps: core, export-semantic, plugins, zod
  ← @scrivr/react     (imports @scrivr/ai + @scrivr/plugins)
apps/docs → core, ai, plugins, react, ai-sdk
```

**Cycle fix (must land with the move).** Three files in `@scrivr/plugins` import
`findNodeById` from `../ai-toolkit/UniqueId` (a re-export of core). If ai-toolkit
moves to `@scrivr/ai` while track-changes stays, that becomes
`@scrivr/plugins → @scrivr/ai → @scrivr/plugins`. Repoint them to `@scrivr/core`
(the canonical home):

- `track-changes/lib/applyDiffAsSuggestion.ts`
- `track-changes/lib/applyRichDiffAsSuggestion.ts`
- `citation-highlight/CitationHighlight.ts`

**zod** is a real `dependency` of `@scrivr/ai` (v4.x, already in the lockfile).
The schemas are part of the public API.

## Decisions

- **D1 — Merge engine stays in `@scrivr/plugins/track-changes`** (exported).
  `@scrivr/ai` builds the semantic layer on top. Keeps track-changes cohesive and
  avoids widening plugins' surface with low-level primitives.
- **D2 — Hard move, documented breaking change.** No compat re-exports from
  `@scrivr/plugins`; the internal consumers switch to `@scrivr/ai`. Flagged
  **BREAKING** in the changeset. We are pre-1.x.
- **D3 — zod is a first-class dependency of `@scrivr/ai`;** schemas are public.
- **D4 — `nodeId`-only addressing for inline edits;** positional anchors only for
  structural create ops.
- **D5 — `getRichBlocks` returns units-with-nested-`parts`** (agent sees the
  grouping) rather than a flat leaf list.

## Phased implementation

### Phase 1 — package + leaf-based inline edits
Extract `@scrivr/ai`; add `parts` to `SemanticUnit`; emit parts for container
units; revert the merge to leaf-only + non-textblock reject; `getRichBlocks` /
`applyRichEdit` on leaves; zod schemas for read units + `RichSemanticEdit`;
playground on leaf targets. Result: any leaf anywhere (incl. list items, table
cells) is inline-editable with zero echo churn.

### Phase 2 — basic structural ops
`insertBlock`, `deleteBlock`, `insertListItem`, `deleteListItem`,
`insertTableRow`, `deleteTableRow` — represented as tracked delete/insert
suggestions. Introduce `applySemanticEdits(editor, edits, { asSuggestion })`
routing rich vs structural.

### Phase 3 — move ops
`moveBlock`, `moveListItem` — tracked delete at old + insert at new.

### Phase 4 — table columns
`insertTableColumn`, `deleteTableColumn`. Reject complex merged-cell tables rather
than corrupt geometry.

### Phase 5 — first-class structural track-change primitives
`CHANGE_OPERATION.insert_node` / `delete_node` / `move_node`, replacing the
delete+insert fallback.

## Files to create / modify (Phase 1)

- **Create** `packages/ai/` (mirror `packages/export-semantic/`): `package.json`,
  `tsup.config.ts`, `tsconfig.json`, `src/index.ts`, `src/schema/*`.
- **Move** `packages/plugins/src/{ai-toolkit,ai-suggestion}/*` → `packages/ai/src/`.
- **Modify** `packages/plugins/src/index.ts` (drop the two `export *`),
  `track-changes/lib/applyDiffAsSuggestion.ts`,
  `track-changes/lib/applyRichDiffAsSuggestion.ts`,
  `citation-highlight/CitationHighlight.ts` (cycle fix; leaf-only merge).
- **Modify** `packages/core/src/exports/semantic.ts` (`SemanticPart` + `parts?`).
- **Modify** `packages/export-semantic/src/walker.ts` (emit `parts` for container
  units; reuse `extractSemantic`).
- **Modify** consumers: `apps/docs/src/playground/ChatPanel.tsx`,
  `apps/docs/src/routes/api/ai.ts`, `packages/react/src/hooks/useAiSuggestion*.ts`,
  `packages/react/src/components/AiSuggestion*.tsx`.
- **Reuse:** `findNodeById` (core), `spansToFragment`/`sameMark`/
  `resolveInlineMark` (core), `unitRichHash`/`fnv1aHex`/`stableStringify`,
  `applyRichDiffAsSuggestion`/`buildAcceptedTextMap`/`diffText`/`mergeTrackedMarks`
  (track-changes), `extractSemantic` (export-semantic).

## Verification

- **Round-trip fidelity:** a doc with paragraph, heading, hard-break paragraph,
  list, table (+ trailing paragraph); echo every leaf from `getRichBlocks` →
  **0** tracked changes, `applied === false`.
- **Real edits:** bold a word in a list item and a table cell → one `mark-change`
  each, zero `text-change`; paragraph alignment → one tracked
  `set_node_attributes`.
- **Guard:** a rich edit targeting a list/table container `nodeId` → rejected, doc
  untouched, warning surfaced.
- **Schema:** malformed agent output (bad mark type, missing `nodeId`, extra keys)
  → `Schema.safeParse` fails cleanly; valid output parses to typed edits.
- **Move safety:** the extraction is mechanical — `pnpm build` / `pnpm typecheck`
  / `pnpm test` green with zero behavior change.
- **Live (playground):** `pnpm dev:docs` + `ANTHROPIC_API_KEY`; NDA; "bold every
  placeholder", "highlight the pricing clause", "bold the second list item", "bold
  cell B2" → suggestions only where asked, no whole-doc churn.

## Open questions

- Structural suggestions as delete+insert vs first-class ops — decide at Phase 2.
- A constrained tool schema *derived from* the zod schemas so the agent can only
  emit valid edits (nice-to-have; the validator is the safety net regardless).
- Whether custom extensions contributing new leaf textblock types register their
  editability (so `parts` emission and the non-textblock guard stay open, not a
  hardcoded type list).

## Dependencies

- Builds on the shipped `@scrivr/export-semantic` emitter (`toSemanticUnits`,
  `unitRichHash`, `diffSemanticUnits`) and the freshness substrate
  (`fnv1aHex`/`stableStringify`, collab-safe `nodeId`s).
- Builds on `@scrivr/plugins/track-changes` (tracked-suggestion apply).
- Source design: the approved Rich Semantic Merge office-hours doc (Approach
  B+C), refined here with the leaf-edit model and the package split.
