# RFC: Sourced Blocks — content with provenance

Status: draft (2026-08-19) · updated 2026-08-20 — prereq resolved by #141

## Problem

Every document model we have assumes content is *native*: it was authored here,
it belongs here, and this document is the only thing that knows about it.

A large class of real features breaks that assumption:

| Feature | The content came from | And it can drift |
|---|---|---|
| Clause library | a canonical clause, version 3 | user negotiated it to Net 45 |
| Definitions | a shared definitions register | this contract narrows it |
| Policy sections | a policy document | localised for a region |
| Signature blocks | an org template | one signatory removed |
| Precedent text | another matter's document | adapted |
| Disclosures | a compliance library | superseded by a newer version |

Each of these is the same shape: **a region of ordinary, fully editable document
content that has an identity and a canonical source outside this document, and
that may legitimately diverge from it.**

Built one at a time, each becomes its own node type, its own divergence
tracking, its own copy/paste rules, its own DOCX mapping, and its own set of
subtle bugs at the same seams (split, drag, clone, collab, undo). Built once, it
is one primitive and each feature is configuration.

The first consumer is the clause library. It should not be the abstraction.

## The invariant

> **A source is canonical reusable content. A sourced block is document content
> with provenance. Editing a sourced block must never mutate its source, and
> updating a source must never silently mutate a document.**

Both halves matter, and the second is the one legal drafting cares about most: a
signed contract's text cannot change because someone tidied the library.

## 1. The primitive

```json
{
  "type": "sourcedBlock",
  "attrs": {
    "instanceId": "src_01J...",
    "kind": "clause",
    "resourceId": "cl_456",
    "versionId": "clv_003",
    "baseHash": "h1:9f2c...",
    "baseNormalizer": 1
  },
  "content": [ { "type": "paragraph", ... }, { "type": "bulletList", ... } ]
}
```

Schema:

```ts
sourcedBlock: {
  group: "block",
  content: "block+",
  defining: true,
  isolating: false,
  attrs: { instanceId: {}, kind: {}, resourceId: {}, versionId: {},
           baseHash: {}, baseNormalizer: {} },
}
```

Four things about this shape are deliberate.

**It wraps blocks, not text.** Reusable content is paragraphs, lists, tables,
headings, nested formatting. A mark or a decoration cannot carry that. Identity
belongs around a block range.

**It is a node, not a decoration.** Decorations are local view state; two
collaborators would see different documents. Provenance is part of the shared
document (see §9).

**`kind` is a free string, not an enum.** Core does not know what a clause is.
`kind` selects which registered `SourceKind` interprets the block — label,
actions, provider, DOCX alias. Adding "definition" adds no core code.

**`baseHash` + `baseNormalizer` are stored in the document.** They record what
the content looked like *when it came from the source*, so divergence is
computable offline, without a network round-trip, and survives export/import.
`baseNormalizer` is the amendment: hashes are only comparable within a
normalizer version, and normalization *will* change. Without the version stamp,
one release that alters normalization silently flips every synced block in every
document to MODIFIED at once. On mismatch we recompute against the stored source
rather than trusting the comparison.

**`isolating: false`** is intentional and is the harder call. Isolating would
make boundary handling trivial but would forbid selecting across the boundary,
which is wrong: a lawyer must be able to select a paragraph before the clause
through to a paragraph after it. §4 pays for that choice explicitly.

## 2. Who owns what

```
┌─ Scrivr (@scrivr/core) ────────────────────────────────────────┐
│ "This region is instance src_1, kind=clause, from cl_456@v3,   │
│  and its content currently differs from what it arrived as."   │
│                                                                │
│ inserted · edited · removed · copied · pasted · split · cloned │
└────────────────────────────────────────────────────────────────┘
                            ↕ SourceProvider
┌─ Host application ─────────────────────────────────────────────┐
│ cl_456 → clause → versions → instances → org → permissions     │
│ search · fetch · create · version · register · reconcile       │
└────────────────────────────────────────────────────────────────┘
```

Core never learns about organizations, Prisma, auth, or HTTP.

```ts
interface SourceProvider<TMeta = unknown> {
  kind: string;
  search(query: string, signal?: AbortSignal): Promise<SourceSearchResult<TMeta>[]>;
  /** Full content for insertion. */
  fetch(resourceId: string, versionId?: string): Promise<SourceContent>;
  /** Called after a block is inserted/created, so the host can index it. */
  registerInstance(event: SourcedBlockEvent): Promise<void>;
  /** Called when divergence state changes. Host persists/indexes as it likes. */
  onInstanceChanged?(event: SourcedBlockChangedEvent): Promise<void>;
  /** Host authority for gating node actions (see node-actions-rfc §4). */
  can?(capability: SourceCapability, resourceId: string): boolean;
}

interface SourceContent {
  resourceId: string;
  versionId: string;
  /** A Scrivr fragment as JSON — parsed against the editor's own schema. */
  contentJSON: unknown;
  label: string;
}
```

Providers register per `kind`, so one editor can host a clause library and a
definitions register simultaneously without either knowing about the other.

Following the dual-surface precedent: providers can be supplied by an extension
(kit authors) *or* by a constructor option (app authors). Server-side use
(`ServerEditor`) must work with providers absent — insertion is a client action;
loading, hashing, exporting and reconciling are not.

## 3. Identity

`instanceId` is minted by the **command that creates the block**, never by a
parser, normalizer, or load path. This is the same rule as `nodeId`: writes
assign identity, reads never fabricate it, so `ServerEditor` loading a document
twice produces byte-identical output.

Consequences, each of which is a real bug if missed:

- **Insert** mints a fresh `instanceId` inside the insertion transaction, so the
  id exists in the document before any persistence round-trip.
- **Copy/paste** re-mints. Two regions may share `resourceId`/`versionId` but
  never `instanceId` — one identity must not appear twice in one corpus. The
  clipboard handler walks pasted fragments and re-mints, mirroring how paste
  already handles `nodeId`.
- **Clone** re-mints, via `addCloneHandlers`. Document clone mode (#135) gives us
  an independent id space and an old→new map; a cloned document's sourced blocks
  are *new instances of the same source*, not the same instances. (This hook was
  silently dropped by StarterKit until #141 — worth a test that asserts it fires
  through the kit, not just in isolation.)
- **Cross-tenant paste** must not preserve `resourceId`. Core cannot know tenancy
  boundaries, so the provider gets a veto: `SourceProvider.adoptPasted(attrs)`
  returns either rewritten attrs or `null`, meaning "strip provenance, paste as
  ordinary content." Default when no provider is registered: strip. Failing
  closed is correct here — a dangling cross-org reference is worse than lost
  provenance.

## 4. The contiguity invariant

> **A sourced block is always exactly one contiguous subtree. It never becomes
> discontiguous, never nests, and never survives as an empty shell.**

This is the invariant that will actually break in practice, and — per the
anchor-only-paragraph lesson — it has to hold at *every* layer that can violate
it, not just the one where the symptom first appears:

| Layer | Rule |
|---|---|
| **Edit** | Splitting a block (Enter at top level inside it) keeps one block. Moving content *out* removes it from the block; the block stays contiguous and becomes MODIFIED. |
| **Delete** | Deleting all inner content removes the wrapper too. `sourcedBlock` with empty content has no meaning. |
| **Drag** | Dragging a child out is a remove-from-block, not a split. Dragging the block itself moves the whole subtree. |
| **Paste** | Pasting a fragment that contains *part* of a sourced block strips provenance from that part. A partial copy is not an instance. |
| **Nav** | Arrow/Home/End treat the boundary as ordinary block structure — no invisible caret traps. |
| **Layout / pagination** | The block may split across pages freely. Pagination is a *visual* concern and must not fragment identity; fragments carry the instance id for gutter placement only. |
| **Selection** | A selection may cross the boundary (§1). What it *yields* — clipboard, formatting, capabilities — is the selection system's business, not this node's. |

Enforcement is a normalization plugin (`appendTransaction`) that repairs
violations, plus schema-level `excludes` for nesting:

```ts
// A sourcedBlock may not contain another sourcedBlock.
// Composition belongs at the library level (a clause referencing a clause),
// not at the document level.
```

Nesting is prohibited outright in v1. Composed sources are a real future want,
but as a library-model concept, not nested document wrappers — nested instances
make divergence, update, and detach ambiguous in ways with no obvious right
answer.

**This section is where the abstraction gets tested.** If normalization here
turns into a pile of special cases, the primitive is wrong and we should know
before the clause extension is built on it.

## 5. Divergence

Two dimensions, computed, never stored as a state enum:

```ts
interface SourcedBlockState {
  modified: boolean;   // contentHash(now) !== baseHash
  outdated: boolean;   // versionId !== source.currentVersionId
  detached: boolean;   // provenance deliberately removed (block is gone)
}
```

Independent dimensions, so we never grow
`MODIFIED_OUTDATED_ARCHIVED_BUT_ACTIVE`. `modified` is computable offline from
document attrs alone; `outdated` needs the provider and is therefore always
"unknown until asked."

Detection is content hashing, not transaction-watching. Transaction-watching
marks a block modified after type-then-undo, which is wrong and unfixable.

```ts
hash = sha256(stableStringify(normalize(fragment)))
```

`normalize` drops selection, transient ids, `nodeId`, collab metadata, UI attrs,
and — importantly — tracked-change marks, so an in-review edit does not read as
divergence until accepted. It preserves text, marks, links, structure, tables,
and nested attrs. It is versioned (`NORMALIZER_VERSION`), pure, and shared with
`@scrivr/export-semantic`'s change detection rather than written twice.

Hashing runs debounced after transactions that touch a sourced block's range,
not on every keystroke.

## 6. Updating, and the merge we are not building yet

When a source moves v3 → v4, **nothing in any document changes.** The block
reports `outdated`, offers Compare and Update as node actions, and waits.

- Unmodified block → Update is a straight content replacement in one
  transaction, `versionId` and `baseHash` restamped.
- Modified block → this is a three-way merge: BASE = v3 (fetchable), LOCAL =
  current content, REMOTE = v4. We know all three, which is the whole reason for
  storing `versionId` and `baseHash` in the document.

v1 ships Compare + Update-discarding-local (with an explicit warning) and
**does not** ship merge. But the data model makes merge possible later without a
migration, and the leaf-based diff machinery in
`docs/rich-semantic-editing-rfc.md` is the natural engine for it — same problem,
same representation. That convergence is worth protecting: sourced-block merge
should be a *consumer* of the leaf model, not a second diff implementation.

## 7. Collaboration

Provenance is shared state; presentation is local.

```
SHARED (Yjs)                LOCAL (never synced)
────────────────            ────────────────────
instanceId                  hover / gutter open
kind, resourceId            comparison panel state
versionId                   cached outdated flag
baseHash, baseNormalizer    in-flight provider requests
content
```

Because the wrapper is a node, this falls out of existing collab for free —
which is precisely why it is not a decoration.

## 8. Reconciliation — amendment to "reconcile on save"

The natural design says: the document is authoritative for existence; the host's
instance table is an indexed projection; on document save, the server diffs
document instances against DB rows and creates/tombstones as needed.

That is right, but **under Yjs there may be no save event at all.** The naive
version silently never reconciles for collaborative documents.

So reconciliation is defined by trigger, not by hope:

1. **On insert/detach/delete** — the extension emits an event; the host
   opportunistically updates its index. Best-effort, not authoritative.
2. **On document persistence** — whatever "the document was written down" means
   for that host: an explicit save, a HocusPocus `onStoreDocument`, a snapshot,
   an export. The host owns this trigger; core just exposes
   `collectSourcedBlocks(doc): SourcedBlockRecord[]` so the reconcile is a pure
   function of the document.
3. **On demand** — a background sweep the host can run over stored documents,
   using the same pure collector.

The index may lag. It must never be treated as truth. Any UI answering "where is
this clause used?" reads the projection and is allowed to be a few seconds
stale; anything answering "what does this document say?" reads the document.

## 9. Export parity

A new node must render everywhere, not just on canvas.

- **Canvas** — a `BlockStrategy` that lays out children and reserves gutter
  affordance space. Visually near-invisible by default: a subtle left rule on
  hover, never a box around every clause.
- **PDF** — content only, no chrome. Provenance is not printed.
- **DOCX** — `<w:sdt>` structured document tags are the correct carrier and the
  reason this is worth doing properly. `<w:sdtPr>` holds `w:alias` (the label)
  and `w:tag` (a packed `instanceId|kind|resourceId|versionId|hash`);
  `<w:sdtContent>` holds the blocks. Word round-trips this natively, and other
  contract tools understand it. This also advances
  `todo_form_fields_content_controls`, which wants `<w:sdt>` for the same reason
  — one `<w:sdt>` seam, two features.
- **Markdown** — degrades to plain content; provenance is lost. Documented, not
  fixed.
- **Semantic units** — a sourced block is a natural unit boundary and should
  carry its provenance into `@scrivr/export-semantic` output. Downstream AI
  work then knows which spans are boilerplate and which are negotiated, which is
  a materially better signal than raw text.

## 10. Node actions

Every operation on a sourced block is a `NodeAction` (`docs/node-actions-rfc.md`):

| id | when | |
|---|---|---|
| `source.view` | always | open the canonical source |
| `source.compare` | `modified \|\| outdated` | diff against source |
| `source.update` | `outdated` | take the newer version |
| `source.saveVersion` | `modified` | promote local text to a new version |
| `source.reset` | `modified` | discard local divergence |
| `source.detach` | always | strip provenance, keep content |

Gated by `provider.can()` via `disabled()`, not by omission — "Requires library
administrator" beats a menu item that isn't there. This RFC contributes **no**
bespoke UI; if it needs any, node actions are underspecified and that RFC should
absorb the gap.

## Decisions (locked)

1. **Generic `sourcedBlock` primitive; clause is consumer #1.** Not a
   `clauseInstance` node generalized later.
2. **Named `sourcedBlock`**, not `semanticBlock` — "semantic" already means
   semantic *units* in `@scrivr/export-semantic`, and one word with two meanings
   in one repo costs us every future conversation.
3. **Node, not mark or decoration.**
4. **`baseHash` carries a normalizer version.**
5. **`instanceId` minted by commands only**, re-minted on paste and clone.
6. **Contiguous, non-nesting, no empty shells** — enforced at every layer.
7. **Never auto-update document content.** Ever. Not behind a setting.
8. **No three-way merge in v1**, but the data model must not preclude it.
9. **Detach is a first-class operation.** Provenance is not a life sentence.
10. **Archiving a source changes no document.**

## Build order

**Phase 0 — prereq. DONE** (#141, `c8952d7`). StarterKit no longer hand-merges
contributions; it declares its children and the manager flattens them. This
matters concretely for §3: `addCloneHandlers` was one of four hooks the kit
silently dropped, and clone re-minting depends on it — the instance-id rule
below would simply not have fired for any editor built on StarterKit.

**Phase 1 — the primitive.** Node + schema + normalization (§4) + hashing (§5) +
clipboard/clone id re-minting (§3) + `collectSourcedBlocks`. No provider, no UI.
Fully testable headless; this is where the contiguity invariant gets proven.

**Phase 2 — provider + insertion.** `SourceProvider` registry, insert command,
one-undo-step atomicity, events. Still no clause-specific code.

**Phase 3 — divergence UX.** Node actions, gutter, compare view, detach, reset.

**Phase 4 — export parity.** DOCX `<w:sdt>` both directions, PDF, semantic units.

**Phase 5 — clause library** in the host app: schema, API, search, detail page,
usage view. Consumer, not core.

Phases 1–2 are the architecture. Everything after is application.

## Open questions

- **Does `/save as source` wrap the origin text in a sourced block?** Leaning
  yes — the document that donated the text gets provenance too, symmetrically —
  but it means a save mutates the document, which is surprising if the user
  thought they were only copying to a library.
- **Divergence vs. tracked changes.** §5 ignores tracked-change marks so
  in-review edits don't read as divergence. Is that right, or should a pending
  tracked insert inside a clause show as modified-pending? Needs a real
  reviewer's opinion, not ours.
- **Variables inside sources.** A clause containing `{{governingLaw}}` is the
  obvious next step and the reason the primitive is generic. Do variables resolve
  at insert (baking a value) or stay live nodes? Live is clearly right; it
  affects hashing (does a different resolved value count as divergence? — no, the
  *variable node* is what's hashed) and should be settled before Phase 4 freezes
  the DOCX mapping.
- **`isolating: false`** — §1 chose selectability over easy boundary handling.
  If §4's normalization gets ugly, this is the decision to revisit first.
- **Multi-block vs. inline sources.** A defined term is inline, not a block.
  Does that want a sibling `sourcedInline` node sharing the same provider and
  hashing machinery? Probably, and probably not in v1 — but the provider
  interface should not assume block content.
