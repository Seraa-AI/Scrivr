# RFC: Structural Diff — deriving tracked changes from two document versions

Status: draft (2026-07-29)

## Problem

Our track-changes system can only produce changes it *witnessed being made*. A
tracked insert/delete mark is stamped either as a human types (live ProseMirror
transactions the plugin intercepts) or as the AI agent hands us per-leaf
replacement **intent** (`RichSemanticEdit`, applied via
`applyRichDiffAsSuggestion`). In both cases the change is *told to us*.

We cannot answer the inverse question: **"here are two documents — show me what
changed as tracked changes."** That single missing capability blocks a family of
real features:

- **Import a `.docx`** (or any external revision) and surface the differences as
  reviewable suggestions instead of a silent overwrite.
- **Reconcile an offline / out-of-band edit** — a copy that diverged without a
  live transaction stream.
- **Compare two saved versions** ("v3 vs v5") and render the redline.
- **Round-trip an AI rewrite** where the model returns whole new prose rather
  than surgical edits — diff old→new ourselves rather than trust op emission.

The second, sharper problem is **quality**, and it exists even in the paths we
*do* support today. Our only diff engine is `diffText.ts` — a token-level LCS
over a *single leaf's* flat text. It has no notion of block identity or block
order. So when a paragraph or list item **moves**, we have no way to see it as a
move: the block vanishes at the old spot and reappears at the new one, and the
redline reads as a full delete + full insert. Reorder a five-item clause list and
the review is a wall of struck-through and re-inserted text for content that
didn't change a character.

This is precisely the case commercial document-comparison tools (DeltaXML,
Draftable, Litera, and treediff.com, which prompted this research) lead with:
staying legible when *structure* changes — distinguishing content **movement**
from content **modification**. We are the weakest exactly where the market says
it matters most, and we lack the primitive (a diff over the *tree*, not the
*text*) to fix it.

## Direction

Build a **structural diff**: given two versions of a document tree, derive an
ordered `SemanticEdit[]` — block insert / delete / **move**, plus intra-leaf
rich edits — that reconstructs `target` from `base`, and feed it into the
**existing** tracked-suggestion sink.

The engine is **scope-polymorphic**. `base` and `target` are each *either* a
whole document *or* a single node's subtree; the algorithm is identical, it just
roots its leaf-sequence projection at the doc or at the node. One engine serves:

- **Whole-document diff** — the version-compare / import case above.
- **Node-scoped diff** — two versions of one block or container subtree.
  Buys per-node version history, cheap re-diff of *only* the changed subtree
  (not the whole doc), and a way to verify a single-node AI edit by diffing that
  node's before/after. Because the output is addressed by `nodeId`, a node-scoped
  diff and a whole-doc diff produce the same shape and drop into the same sink.

And it reframes track changes as having **two producers, one representation**:

| Source | How changes arise | Producer |
|---|---|---|
| **Live** track changes | intercept ProseMirror transactions as the user types | existing plugin |
| **Version** track changes | structural-diff two snapshots / versions | **this engine** |

Both stamp the *same* `dataTracked` marks and flow through the *same* review UI —
accept/reject is identical whether a change was witnessed live or derived from a
version pair. "Version track changes" is not a second track-changes system; it is
a second *way to fill* the one we have. Version-history **storage** and its
timeline **UI** are consuming features, out of scope here — this RFC delivers the
diff primitive they stand on.

This is the derivation counterpart to
[`rich-semantic-editing-rfc.md`](./rich-semantic-editing-rfc.md). That RFC owns
the **apply** side: a `SemanticEdit` (agent-emitted intent) → tracked
suggestions. This RFC owns the **derive** side: two versions → the same
`SemanticEdit[]`. They meet at one representation and one sink:

```
      rich-semantic-editing-rfc                    this RFC
   agent intent ───────┐        computeStructuralDiff(base, target, { scope })
                       │          whole-doc │ node-subtree   (version source)
                       ▼                    ▼
                    SemanticEdit[]  (the reserved discriminated union)
                       │
   live txns ──────────┤   (existing live track-changes producer)
                       ▼
         applySemanticEdits → track-changes → reviewable suggestions
                                (one dataTracked representation, one review UI)
```

Crucially, the structural op types this diff emits are **already reserved** in
the edit protocol (`StructuralSemanticEdit`: `insertBlock` / `deleteBlock` /
`moveBlock` / list-item / table-row ops — `packages/ai/src/schema/edit.ts`, the
sibling RFC's Phase 2–5). This RFC does not invent a new patch language. It
builds the engine that *produces* those ops from a version pair, and in doing so
gives the reserved structural union its first real producer — today only the
agent can emit them, and only one at a time.

## Non-goals (this RFC)

- **Full recursive tree-edit-distance.** Our document tree is shallow
  (`doc → block → optional container → leaf`) and every leaf carries a stable
  `nodeId`. A flat leaf-sequence diff with id/hash anchoring gets us move
  detection without the O(n³) Zhang–Shasha machinery. Revisit only if deep nested
  structures (nested tables) demand it.
- **Three-way / author attribution.** Specced here as the natural extension
  (§ Three-way) but built after two-way lands.
- **A new merge engine.** Intra-leaf diffing and tracked-mark emission are
  `diffText` + `applyRichDiffAsSuggestion`, unchanged. This RFC only adds the
  *block-level* layer above them.
- **Changing `SemanticUnit` embedding semantics.** The flat `text` projection
  stays as-is.
- **Semantic-equality of marks/attrs beyond the existing rich hash.** We reuse
  `unitRichHash`; we do not build a formatting-aware distance metric in v1.

## Core insight

The diff does not need to walk the ProseMirror tree, and it does not need
positions. **Two facts make a flat, cheap algorithm correct:**

1. **The tree is already flattened, with identity.** `toSemanticUnits(doc, {
   groupBlocks:false })` (from `@scrivr/export-semantic`) yields an ordered leaf
   sequence — each leaf a `SemanticPart` with a stable `nodeId`, `type`, `text`,
   and `spans`. Two versions become two `SemanticPart[]`. Block matching is a
   sequence-alignment problem over that array, not a tree traversal.

2. **`nodeId` collapses the hard part of tree matching.** The expensive step in
   GumTree-style differs is *finding which node in A corresponds to which node in
   B*. When both versions descend from the same document (live divergence,
   collab, an AI rewrite of a doc we assigned ids to), matching is an id lookup —
   exact and O(n). Similarity search is the *fallback* for id-less inputs
   (imported `.docx`), not the common path.

This mirrors the sibling RFC's core insight (`nodeId` is the durable,
depth-agnostic address) and extends it: `nodeId` is also the durable *match key*
across two versions.

## Algorithm

```ts
computeStructuralDiff(
  base:   PMNode,                 // whole doc OR a single node subtree
  target: PMNode,                 // must be the same scope as base
  opts?: { scope?: "document" | "node" }  // inferred from the node type; explicit for clarity
): SemanticEdit[]
```

Five stages. Stages 4–5 are existing code; the new work is stages 1–3. **Scope
changes nothing but the projection root** in Stage 1 — every later stage operates
on `SemanticPart[]` and is oblivious to whether that array came from a document
or a subtree.

### Stage 1 — leaf sequences
Project both inputs to ordered `SemanticPart[]` via the existing
`toSemanticUnits(_, { groupBlocks:false })`, rooted at the input node — a whole
`doc` yields the document's leaves; a single block/container yields just that
subtree's leaves. Each part: `{ nodeId, type, breadcrumb, text, spans, richHash }`,
where `richHash = unitRichHash({ text, spans, attrs })` (existing FNV-1a). From
here the algorithm is scope-free.

### Stage 2 — block matching (the tree diff)
Match `base[i] ↔ target[j]` in three tiers, most-confident first:

1. **Id anchor** — equal `nodeId` ⇒ matched pair. (Live/collab/AI-on-known-doc.)
2. **Hash anchor** — equal `richHash` among the id-unmatched remainder ⇒ matched,
   verbatim-unchanged. (Handles id-less imports where a block is untouched.)
3. **Similarity fallback** — greedy best match over what's left, by
   Sørensen–Dice on token bigrams (reusing `tokenise` from `diffText.ts`), above
   a tuned threshold ⇒ **modified** pair. (A block that was edited *and* moved
   still matches here.)

Leftover `base` parts ⇒ **deleted blocks**. Leftover `target` parts ⇒
**inserted blocks**.

### Stage 3 — move detection
Take the matched pairs in `target` order and read off their positions in `base`
order. Run **LCS over that index sequence** — the exact `diffText` LCS, with a
matched-block key as the token instead of a word. Pairs **on** the LCS kept their
relative order (stable context). Pairs **off** the LCS are **moved** ⇒ emit
`moveBlock`. This is the standard reorder-vs-rewrite discriminator, and it reuses
the LCS we already ship.

### Stage 4 — intra-leaf diff (existing)
For every **modified** matched pair, run today's path unchanged:
`diffText(base.text, target.text)` → `pairReplacements` → `expandCharLevel` →
`applyRichDiffAsSuggestion` span/mark diff. Zero new code; block matching just
tells it *which* leaves to compare.

### Stage 5 — emit
Assemble an ordered `SemanticEdit[]`:
`deleteBlock` · `insertBlock` · `moveBlock` (structural union) + `richText` per
modified leaf. Hand to `applySemanticEdits(editor, edits, { asSuggestion:true })`
→ tracked suggestions. Same sink as the agent path.

### Prior art
This is a pragmatic specialization of GumTree (top-down anchor, bottom-up
similarity) and classic sequence LCS, chosen over Zhang–Shasha tree-edit-distance
because our tree is shallow and `nodeId`-anchored. Naming the lineage so the
choice is defensible, not folklore.

## Data model

No new document types. The output is the **reserved** structural union from
`packages/ai/src/schema/edit.ts` — this RFC makes it real:

```ts
// Emitted by computeStructuralDiff — all already specced in the sibling RFC.
type SemanticEdit =
  | { kind:"richText"; nodeId; spans?; attrs?; expectedContentHash? }        // Phase 1 (shipped)
  | { kind:"structural"; op:"insertBlock"; position; anchorNodeId; block }   // reserved
  | { kind:"structural"; op:"deleteBlock"; nodeId }                          // reserved
  | { kind:"structural"; op:"moveBlock";   nodeId; position; anchorNodeId }  // reserved
  // …list-item / table-row ops likewise
```

One internal type is new — the match result, an implementation detail of the
diff, never serialized to the agent or the document:

```ts
interface BlockMatch {
  base:   SemanticPart | null;   // null ⇒ inserted
  target: SemanticPart | null;   // null ⇒ deleted
  kind: "id" | "hash" | "similarity" | "insert" | "delete";
  moved: boolean;                // set in Stage 3
  similarity?: number;           // for the similarity tier, for diagnostics
}
```

## Where it lives

`computeStructuralDiff` goes in **`@scrivr/ai`** (`packages/ai/src/diff/`). It
emits the `SemanticEdit` protocol, which `@scrivr/ai` owns and publishes; it
already depends on `@scrivr/export-semantic` (for `toSemanticUnits` /
`unitRichHash`) and `@scrivr/plugins/track-changes` (for the apply sink). No new
dependency, no cycle: `core ← export-semantic ← plugins ← ai`.

The pure block-matching core (`matchBlocks`, `detectMoves`) takes and returns
plain `SemanticPart[]` / `BlockMatch[]` with **no** AI, model, or track-changes
coupling — so if non-AI consumers (import, version-compare) later want the diff
without pulling `@scrivr/ai`, it graduates cleanly to a provider-agnostic
`@scrivr/diff`. We do **not** create that package pre-emptively (no consumer
yet); we keep the seam clean so the move is mechanical. (See
`project_render_environment_evolution` — don't rename before the second consumer
exists.)

## Three-way (later phase)

Two-way answers "what changed." Three-way answers "**who** changed it, and do
they conflict" — the collaboration case, and treediff.com's headline for
multi-author review.

Given `base`, `local`, `remote`:

- Run `computeStructuralDiff(base, local)` and `computeStructuralDiff(base,
  remote)` — two edit sets keyed by matched `nodeId`.
- **Attribution** — each target block's changes carry the author of the branch
  that changed it.
- **Conflict** — a block changed in *both* branches (or moved in one, edited in
  the other) sets the existing **`isConflict`** flag on the tracked change
  (`track-changes` already models this; see `docs/multi-author-tracked-changes.md`).
  Non-overlapping changes merge cleanly.

This reuses the two-way engine twice plus a keyed join — no third algorithm — and
plugs into track-changes' existing multi-author machinery rather than inventing
attribution.

## Decisions

- **D1 — Reuse the reserved `StructuralSemanticEdit` union as the patch
  representation.** The diff produces `SemanticEdit[]`; AI-emitted and
  diff-derived edits are the same shape and share one sink. No new patch language.
- **D2 — Flat leaf-sequence diff, not recursive tree-edit-distance.** Justified
  by the shallow, `nodeId`-anchored tree (§ Core insight).
- **D3 — Move detection via LCS over matched-block order,** reusing `diffText`'s
  LCS generalized to a block key.
- **D4 — Three-tier matching (id → hash → similarity).** Id is the common,
  exact path; similarity (Dice on `tokenise` bigrams, tuned threshold like
  `CHAR_DIFF_SIMILARITY_THRESHOLD`) is the id-less-import fallback only.
- **D5 — Home is `@scrivr/ai`, with a clean seam to graduate a `@scrivr/diff`**
  package if/when a non-AI consumer lands. Not pre-emptively split.
- **D6 — Intra-leaf diffing is unchanged** (`diffText` /
  `applyRichDiffAsSuggestion`). This RFC is strictly the block layer above it.
- **D7 — Scope is a projection detail, not a second algorithm.** Node-scoped and
  whole-doc diffs share one code path; scope only sets the Stage-1 root. Node
  scope is available from Phase 1 at no extra cost.
- **D8 — "Version track changes" is a second *producer*, not a second system.**
  It reuses live track-changes' `dataTracked` marks, review UI, and accept/reject.
  This RFC owns the producer; version snapshot storage + timeline UI are separate
  consuming features.

## Phased implementation

### Phase 1 — two-way structural diff (doc + node scope), no moves
`matchBlocks` (id + hash tiers) + `computeStructuralDiff` emitting
`insertBlock` / `deleteBlock` + `richText` for matched-but-modified leaves, with
**scope-polymorphic Stage-1 projection so whole-doc and node-subtree diffs both
work from day one**. Depends on the sibling RFC's `applySemanticEdits` +
structural apply (its Phase 2). Unlocks version-compare, import-diff, and
node-scoped re-diff for the common (id-stable / verbatim-unchanged) case.

### Phase 2 — move detection
Stage 3 LCS + `moveBlock` emission. This is the quality win: reorders stop
reading as delete+insert.

### Phase 3 — similarity matching
The Dice fallback tier, unlocking id-less imports (`.docx` with no `nodeId`s) and
moved-and-edited blocks. Gated behind a threshold with a `computeEditDensity`-style
noise guard so a poor match degrades to insert+delete rather than a nonsense pairing.

### Phase 4 — container ops (lists, tables)
Extend matching into list items and table rows via their leaf `parts` (already
addressable). Emit `insertListItem` / `moveListItem` / `insertTableRow` etc.
(sibling RFC Phases 2–4).

### Phase 5 — three-way / attribution
`computeStructuralDiff` ×2 + keyed join → `isConflict` + author attribution
through the existing multi-author track-changes path.

## Verification

- **Identity:** `computeStructuralDiff(doc, doc)` → `[]`, zero suggestions.
- **Scope equivalence:** a node-scoped diff of subtree `N` equals the subset of
  the whole-doc diff addressed to `N`'s `nodeId`s — same ops, same order.
- **Version track changes:** diff two saved snapshots → suggestions render and
  accept/reject *identically* to live-typed tracked changes (same marks, same UI).
- **Pure move:** swap two paragraphs (ids stable) → **one** `moveBlock`, zero
  text-changes. (Today: two full delete+insert pairs — the regression this fixes.)
- **Reorder a 5-item list** → moves only, no struck text.
- **Edit-in-place:** change one word in one block → one `richText` /
  intra-leaf mark, no structural op.
- **Move + edit:** relocate and reword a block → one `moveBlock` + a surgical
  intra-leaf diff (via the similarity tier), not delete+insert.
- **Id-less import:** strip `nodeId`s from `target`, change one block → hash tier
  matches the untouched blocks, similarity tier finds the edited one; changes
  localized, not whole-doc churn.
- **Round-trip through the sink:** derived `SemanticEdit[]` → `applySemanticEdits`
  → accept all → resulting doc deep-equals `target`.
- **Three-way (Phase 5):** disjoint edits merge clean with correct authors;
  same-block edits in both branches set `isConflict`.

## Open questions

- **Similarity metric & threshold.** Dice-on-bigrams is the proposal; validate
  against real legal reorders before locking the threshold (mirror the empirical
  tuning behind `CHAR_DIFF_SIMILARITY_THRESHOLD`). Guard against
  `fuzz_overfit_risk` — tune on real user revisions, not random docs.
- **Move vs delete+insert boundary.** When a "moved" block is also heavily
  edited, is it one `moveBlock`+intra-diff, or clearer as delete+insert? Likely a
  `computeEditDensity` gate — decide with a real reviewer in the loop.
- **Import provenance.** Should an imported `.docx` diff attribute every change to
  a synthetic "imported" author (three-way-lite against the pre-import doc)?
- **`findChanges` adjacency.** Block-level moves will interact with the open
  `findChanges` mark-adjacency gap (`bug_trackchanges_markchange_no_adjacency_merge`)
  — confirm move grouping doesn't fragment there.
- **DOCX parity.** Per `feedback_pdf_parity` / DOCX-is-tree-driven — any tracked
  `moveBlock` must map to a DOCX revision representation (`<w:moveFrom>` /
  `<w:moveTo>`), not just render on canvas. Scope for Phase 4+.

## Dependencies

- **`@scrivr/export-semantic`:** `toSemanticUnits({ groupBlocks:false })`,
  `unitRichHash`, `diffSemanticUnits` (the existing set-membership matcher this
  generalizes).
- **`@scrivr/plugins/track-changes`:** `diffText` (LCS, reused for move
  detection), `applyRichDiffAsSuggestion`, the `dataTracked` marks, `isConflict`.
- **`@scrivr/ai`:** the `SemanticEdit` protocol + `applySemanticEdits`, and the
  structural-apply work from `rich-semantic-editing-rfc.md` Phases 2–5 (hard
  prerequisite — this RFC *derives* those ops; that RFC *applies* them).
- **Source design:** research into treediff.com's structural-diff / three-way
  model (2026-07-29), reframed onto our `nodeId`-anchored leaf model and existing
  tracked-suggestion sink rather than its opaque patch format.
