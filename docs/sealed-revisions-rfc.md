# RFC: Sealed Revisions

Status: draft (2026-09-28); path locked 2026-11-11 after the design checks below

## Problem

An application built on Scrivr needs to say, and be able to prove, *this exact
document is what was agreed*. Signing ceremonies need it. So do regulatory
submissions, board approvals, published releases and anything that produces an
executed artifact.

Scrivr today cannot say it. Three gaps:

**1. Nothing is a mutation boundary.** `readOnly` gates the command wrapper
(`buildCommands` in `BaseEditor.ts`), the input bridge (`Editor.setReadOnly`) and
`deferEdit`. It does *not* gate `applyTransaction`, whose own doc comment names
its callers: "plugin metadata via `tr.setMeta()`, programmatic `deleteSelection`,
custom transforms, or external sources (Y.js remote sync, AI suggestions)". Nor
does it gate `EditorSurface.dispatch`, which header/footer content goes through.
A read-only editor accepting *remote* Yjs updates is correct — a viewer in a live
room should watch others type. Accepting *local* programmatic edits is the live
bug, and nothing at all can refuse every origin, which is what a seal needs.

**2. The collaboration substrate has no revision identity.** `Collaboration`
creates a `Y.Doc` and a `HocuspocusProvider` per editor
(`packages/plugins/src/collaboration/Collaboration.ts`, `onEditorReady`). A room
is a name. There is no revision, no epoch, and nothing that can refuse an update.
A client that went offline before a freeze reconnects and its buffered ops merge,
because that is what a CRDT is for.

**3. There is no canonical content hash.** `@scrivr/export-semantic` has the
right shape — `toSemanticUnits`, `unitContentHash`, `unitRichHash` — but those
are FNV-1a (`changeDetection.ts:43`), a *change detector*. Fast, non-cryptographic,
trivially collidable on purpose. Useful for "did this unit change?", useless as
tamper-evidence.

## Scope

Scrivr owns: **a collaborative revision can become immutably sealed, and everyone
— live, late, offline — observes the same boundary.**

Scrivr does not own: signers, invitations, identity, consent, declines,
deadlines, evidence ledgers, completion certificates. Those are the host
application's. Scrivr's vocabulary stops at *editable revision*, *sealed
revision*, *canonical snapshot*, *rejected stale update*, *forked revision*.

## The central decision: three lanes, not one editor mode

The instinct is to model this as an editor that gets progressively more locked
down. That is wrong, and following it produces a state machine inside core that
core has no business knowing.

Once a revision is sealed, the work that happens on it runs on a **different
substrate**: an immutable snapshot plus a value store Scrivr never owns. There is
no Y.Doc, no provider, no epoch. Fencing machinery is not ceremony machinery —
it exists only to make the *transition* safe for drafters who were mid-edit.

| Lane | Substrate | Consumer | Mutable |
|---|---|---|---|
| **A · Authoring** | Y.Doc + provider | host's drafting app | yes |
| **B · Sealing** | headless, server-side | host's **backend** | the transition itself |
| **C · Consumption** | canonical snapshot, no provider | host's viewer/ceremony app | never |

Three lanes, three APIs, three failure modes. The proposal this RFC replaces put
lanes A and C in one package and one lifecycle enum; that is the conflation to
avoid.

### The rule that falls out

**A field definition is a node. A field value never is.**

Signature blocks, approval slots, form fields — their *definition* lives in the
document, is authored in lane A, and is part of the hash. Their *value* is
external, held by the host, and merged only at render time when Scrivr paints the
executed artifact.

If values were nodes, every signature would mutate the sealed document and the
hash would stop describing what was agreed. You would need a per-mark exemption
in the mutation gate — "content: deny, except these marks" — which is not a seal.

Keeping values external buys:

- the seal holds unchanged for the entire ceremony, first signer to last
- a declined or abandoned ceremony leaves **zero** trace in the document
- sequential vs parallel completion is "which fields does this viewer get" —
  Scrivr models no ordering at all
- identity, consent and evidence never enter Scrivr's type system

This same rule resolves the annotation question. Comments are marks today
(`project_comments_headless`), so a comment *is* a doc change. Sealed therefore
means `docChanged` denied, full stop; commenting on a sealed revision is an
external overlay anchored by `nodeId`, exactly like field values. We do not ship
a `annotations: "allow"` exemption.

---

## 1. The mutation gate (core)

Core answers one question: **may this transaction change the document?** The
answer depends on two facts, and they are different facts with different owners:

| Fact | Owner | Means | Local edits | Remote collab updates |
|---|---|---|---|---|
| `readOnly` | the host, per viewer | *this person* may not author | denied | **applied** |
| `sealed` | the revision | *this document* may not change | denied | denied |

The draft derived `readOnly` from a single policy. The checks below show why that
is wrong: a read-only viewer in a live room must still receive remote edits, and
a client in the `freezing` drain must still apply the ops the server accepted
before the boundary, or its document will not equal the sealed snapshot. Both
are "local denied, remote allowed" — that is `readOnly`, not `sealed`. Two
owners of two facts is not the two-owners-of-one-fact papercut.

```ts
type MutationOrigin = "local" | "remote";   // remote ⇔ tr.getMeta(COLLAB_SYNC_META)

function admits(tr: Transaction, origin: MutationOrigin): boolean
// sealed            → no docChanged transaction, from any origin
// readOnly, local   → no docChanged transaction
// otherwise         → everything
```

Selection-only and meta-only transactions always pass: a sealed viewer still
selects, copies and focuses fields. The draft's `selection: "deny"` axis had no
consumer and is dropped.

**One gate, two state owners.** The body's state lives in `BaseEditor`; each
header/footer slot owns its own `EditorState` in `EditorSurface`. Both apply
through the same `admits`. A gate only in `applyState` lets a surface keep an
edit the root document will then refuse at commit — the surface shows text the
document does not have.

**Judge the result, not the request.** `EditorState.apply` runs
`appendTransaction`, so a selection-only transaction can come back with an
appended `docChanged` one (normalizers, `UniqueId`, `TrailingNode`). The gate
calls `state.applyTransaction(tr)` and inspects every transaction in the result;
if any changed the document, the whole result is discarded. Nothing partial lands.

**A refusal is reported, never silent.**

- `applyTransaction(tr)` and `EditorSurface.dispatch(tr)` return `boolean`
  (were `void`). Not purely additive: a caller whose arrow function passed the
  old `undefined` along (`(e) => e.applyTransaction(tr)` feeding a `?? fallback`)
  now passes a boolean.
- Commands keep returning `false`.
- `deferEdit` keeps abandoning with `"read-only"`; a sealed editor abandons with
  `"sealed"`.
- The editor emits `"mutationDenied"` with `{ reason: "read-only" | "sealed",
  origin }` so a host learns a seal turned an edit away.

A remote update refused by a sealed editor would leave the Y.Doc and the editor
disagreeing. That cannot happen in lane C, which has no provider; in lane A a
sealed client must stop its binding — phase 5's job, not the gate's.

**This lane is independently valuable.** It closes the local
`applyTransaction` / surface hole whether or not anything downstream ships.

## 2. Revision identity and fencing (collaboration)

Revision mode belongs *here*, not in core. Core answers one question — may this
transaction mutate the document. The lifecycle that decides the answer is a
distributed concern, and it maps onto the policy from outside.

```ts
type CollaborationRevisionState =
  | { mode: "editable"; revisionId: string; epoch: number }
  | { mode: "freezing"; revisionId: string; epoch: number; requestedBy: string }
  | { mode: "sealed"; revisionId: string; epoch: number; contentHash: string; sealedAt: string };
```

Every update carries `{ revisionId, epoch }`. The authority accepts only when
both match and the mode is `editable`. `freezing` is a *server* phase — boundary
established, drain in progress — which the client observes as `content: "deny"`.

**Enforcement is server-side or it is a convention.** The client contract alone
guarantees nothing; a client can be patched. `apps/server/src/index.ts` is a
file-backed demo with an `onAuthenticate` token check and nothing else. This work
ships a HocusPocus **server extension** alongside the client contract, or it does
not ship. Who *may* seal is a host callback on that extension, the same shape as
`onAuthenticate` — Scrivr enforces the boundary, the host decides permission.

### The offline client

This is the case the whole mechanism exists for, and the case the proposal it
replaces did not answer.

Fencing stops a stale update reaching the server. It does not stop the offline
client having already applied those ops locally — that is what a CRDT does. On
reconnect into a sealed revision that client holds edits that will never land.

Discarding them is silent data loss. So: **fork**.

```ts
forkRevision(sealedSnapshot): { revisionId, parentRevisionId }
```

The stale client's work becomes a new editable revision descending from the
sealed one. The host decides whether that fork is worth anything. The same
primitive is the amendment story — a post-seal correction, a counter-signed
addendum, a v2 — so it is load-bearing in two places and is not optional.

## 3. The canonical snapshot (sealing)

Hashing the Yjs state is wrong: the same logical document yields different bytes
depending on update history and client ids. The preimage must be canonical
semantic content, which is what `@scrivr/export-semantic` already produces.

Three consequences:

**The preimage covers every part of the document a reader sees.** Header and
footer content lives in `doc.attrs.headerFooter`, and `@scrivr/export-semantic`
today walks only the body. A hash over body units alone would let a footer
change after sealing without the hash noticing. The canonical serialization
includes the doc attrs that render.

**Semantic emission becomes a determinism contract**, not a best-effort lane. It
has already bitten us once — `decision_deterministic_nodeid_read_path` exists
because reads fabricating nodeIds broke chunk determinism.

**The hash function changes.** `unitContentHash`/`unitRichHash` are FNV-1a change
detectors and stay that way. A revision seal needs SHA-256 over a canonical
serialization. These are different functions for different jobs; do not overload
the existing ones.

### Two hashes, two meanings

The proposal this replaces had sealing "resolve fonts, assets and layout
dependencies" in one step. Sealing *layout* is a far larger promise than sealing
*content*, and this repo has direct evidence it is not free: core tests cannot
assert a text width across machines because Linux CI fonts are not macOS fonts
(`bug_ci_font_drift_width_assertions`).

So:

- `contentHash` — SHA-256 over canonical semantic content. **What was agreed.**
- `artifactHash` — SHA-256 over the exported PDF bytes. **What was displayed.**

The host's certificate probably wants the second. Both are cheap; pretending one
covers both is not.

### A value is painted in its field's box (revised 2026-11-11)

The draft sealed field geometry as coordinates, computed once at seal time,
because a field was not then part of the document — nothing else could say
where its value goes. Phase 3 made fields nodes, which answers that better:

- **A value never enters the document.** The document holds only the empty
  field; `FieldCompletion` holds values outside it, and a sealed editor refuses
  every change at the mutation gate besides. The hash cannot move.
- **A value never changes the layout.** The field's box is fixed by its
  `width`/`height`, set when it was authored; layout reserves it whether empty
  or signed, so nothing reflows.
- **A value stays in its box** — clipped to it, text fitted, an image scaled.

Each surface paints the value in the field's box in *its own* layout: the
viewer in the browser's, the executed PDF in the server's. Where fonts differ
the box moves with its line on both, and the value with it; frozen coordinates
would leave the value where the line used to be. Sealing also no longer needs a
layout engine on a backend that has none. What was displayed is still provable:
that is `artifactHash`, over the executed PDF.

## 4. Viewport telemetry (consumption)

Worth stating because it is easy to miss and only Scrivr can provide it.

**The canvas has no DOM.** A host cannot instrument reading behaviour itself — no
scroll listeners, no `IntersectionObserver` over paragraphs. "The signer scrolled
to the end before signing" is a standard e-signature evidence item and is
obtainable *only* if Scrivr emits it.

Lane C therefore exposes a viewport telemetry surface that the host subscribes to
and writes into its own evidence store. This is a Scrivr responsibility falling
directly out of the rendering architecture.

The granularity is **page-level and nothing finer**:

- page entered / left, with timestamps
- furthest page reached
- `reachedEnd`

No paragraph or line dwell. E-signature law (ESIGN/UETA, eIDAS) asks for intent,
consent, attribution and retention; scroll evidence is a product convention, not
a legal requirement, so the coarse default is the defensible one. Scrivr emits
and never persists; whether to store the events, and whether to tell the signer,
is the host's. A finer level is an opt-in if a real consumer ever asks — adding
detail later is easy, taking it back is not.

---

## Host API sketch

Illustrative, not final — the lane split is what this RFC asks for agreement on.

**Lane A — authoring.** A normal extension; definitions are ordinary nodes.

```ts
editor.commands.insertSignatureField({ role, kind, required })
editor.getSignatureFields(): SignatureFieldDescriptor[]
```

Keyed by **role**, not user: `client-authorized-signatory`, not a person. The
host resolves roles to people when it creates its ceremony, which is what keeps
the document a reusable template and the host's identity model out of Scrivr.
`getSignatureFields()` must work on `ServerEditor` so a backend can validate a
template before anything exists.

**Lane B — sealing.** A backend API.

```ts
const sealed = await revisions.seal(documentName, { expectedEpoch, assignedRoles });
// { revisionId, epoch, snapshot, contentHash, sealedAt, fields }
```

- **`fields` returns *from* the seal.** Reading them in a separate prior call is
  a TOCTOU — a drafter adds a signature block between the read and the freeze and
  the ceremony is missing a signer. The manifest and the hash must be atomic.
- **Every required role is assigned before the seal.** `assignedRoles` is the
  role names the host has mapped to people — names only, never the people.
  The seal fails with `UnassignedRoles { missing }` when a required field's role
  is not in it, and with `UnknownRoles { unknown }` when the host assigned a role
  no field carries (the field was removed after the host invited someone). The
  check runs inside the seal, against the same document the hash is taken over;
  a host checking first is the same TOCTOU as reading `fields` first.
- **Idempotent by `revisionId`.** A backend will retry across a network blip;
  sealing an already-sealed revision returns the same result rather than throwing.
  An `expectedEpoch` mismatch is the only real failure, and it means "someone
  edited after you decided to freeze" — the host shows a diff and asks again.

**Lane C — consumption.** No provider, no Y.Doc.

```ts
new Editor({
  content: snapshot,
  sealed: true,
  extensions: [FieldCompletion.configure({
    fields,                              // snapshot.fields: id, role, kind, required
    completable,                         // field ids THIS viewer may complete
    values,                              // already completed, for display
    onFieldRequest: (field) => Promise<FieldValue | null>,
  })],
});
```

`onFieldRequest` is the seam: the viewer presses a field it may complete, and
the host opens its own capture — signature pad, consent text, authentication —
writes its evidence, and resolves with the value to show, or `null` to leave the
field empty. Scrivr persists nothing. The draft had Scrivr hand the host a value
and revert on rejection; but Scrivr cannot capture a signature — consent UI is
the host's — so the value has to come *from* the host, and there is nothing to
revert.

**Completion.**

```ts
const pdf = await renderExecutedPdf({ snapshot, values, contentHash });
```

`@scrivr/export-pdf` renders `LayoutPages` directly already; this is that path
plus a value-overlay pass over sealed field geometry.

### What the host must NOT be able to do

- apply a transaction to a sealed revision through any path
- mutate field values through the editor
- read another participant's values out of editor state

---

## Phasing

**Phase 1 — mutation gate.** Core only. One `admits(tr, origin)` shared by
`applyState` and `EditorSurface.dispatch`; `readOnly` (local denied) and `sealed`
(all denied) as two facts; judged on the `applyTransaction` result including
appended transactions; refusals reported through return values and
`"mutationDenied"`. Ships alone, fixes a live bug, no dependents.

**Phase 2 — sealed viewer (lane C).** A sealed editor over a static snapshot with
an external value overlay and viewport telemetry. **Deliberately before lanes A
and B**: an entire ceremony can be built and demoed against a hand-made snapshot
with no collaboration involved. If "values are never nodes" survives that, every
decision downstream is de-risked. If it does not, we learn it for the cost of a
viewer.

Locked design (2026-11-11). Three pieces; two new core concepts, flagged.

1. **`sealed: true` constructor option** on `Editor` and `ServerEditor`, beside
   `readOnly`. The content loads, then the editor seals. No new concept.
2. **Reading telemetry.** *New core event* `pagesInView: { first, last }` from
   `TileManager`, the only owner of the scroll position — fired when the range of
   pages actually on screen (no overscan) changes. Paged mode only; a pageless
   view has no pages to report, and a signing view is paged. `ReadingProgress`
   in `@scrivr/plugins` turns it into the evidence shape: page entered / left
   with timestamps, furthest page, `reachedEnd`. Core reports what is visible;
   the evidence vocabulary stays out of core.
3. **Field overlay.** `FieldCompletion` in `@scrivr/plugins`. Fields come from
   the sealed manifest — page plus a page-local rect — never from layout, so
   nothing is re-derived (§3). It paints values and the boxes this viewer may
   complete through `addOverlayRenderHandler`. *New core event* `press:
   { point: PagePoint, clickCount }`, emitted for every primary press before
   body routing, read-only and sealed included — the press-side twin of `hover`,
   which already carries a `PagePoint`. A field is not a document node, so the
   semantic hit-target registry cannot claim it; an event is the smallest seam.

Not in phase 2: `renderExecutedPdf` (phase 4, with `artifactHash` — the PDF value
pass lands with the hash that covers it), field definitions as nodes (phase 3),
keyboard traversal between fields.

**Phase 3 — field definitions (lane A).** The authoring extension. Carries a
format obligation from day one — canvas *and* PDF (`feedback_pdf_parity`), plus
its own import/export handlers (`todo_extension_owned_format_paths`). Answer the
`<w:sdt>` question first (`todo_form_fields_content_controls`): OOXML content
controls serve forms *and* templating, and if signature fields are the same
feature we should not build two.

Decided 2026-11-11 for phase 3, reoriented the same day:

- **Fields are format-neutral.** The first decision made signatures content
  controls — Word's `<w:sdt>`. They are not: Word's own signature is a signature
  line, a VML shape holding `o:signatureline`. So the model names neither; the
  DOCX mapping picks per kind.
- **Each field says who fills it: `fill: "author" | "signer"`.** An
  author-filled value is document content and part of the hash. A signer-filled
  field is always empty in the document; its value is lane C's overlay. A
  signed DOCX is not a goal — the executed artifact is the PDF (phase 4).
- **Inline and block**, as Word allows both.
- **Kinds:** signature, initials, date, text, checkbox. Dropdown later.
- **A pending signature exported to DOCX is signable in Word *and* round-trips.**

Model — three schema pieces, one extension. New, flagged:

| Piece | For | Why this shape |
|---|---|---|
| `field` — inline atom | every signer field; author checkbox | a signer field holds nothing, so it is a box; a checkbox is a glyph |
| `fieldRange` — mark | author-filled text | Word's run-level `<w:sdt>` wraps runs, which is a mark over a range. An inline node *with* content would need LineBreaker, CharacterMap and caret work the engine has never needed — it flattens a textblock to text plus atoms |
| `fieldBlock` — block, `block+` | block-level `<w:sdt>` | the container path `SourcedBlock` already uses |

ProseMirror refuses a node and a mark sharing a name, hence three names.
"Field" also names Word's field codes (`PAGE`, `NUMPAGES`); in this repo those
are header/footer tokens, and the code says "field instruction" for them.

A signer field carries `role` and `required` and no value attr.
`listSignerFields(doc)` gives `{ id, role, kind, required }`, so a backend can
validate a template on `ServerEditor`. Geometry is added at seal time (phase 4).

### DOCX mapping (3d)

Every field exports as an `<w:sdt>` whose `w:tag` carries Scrivr's metadata —
id, kind, fill, role, required — which is what round-trips. Inside it:

| Kind | `sdtContent` | Word sees |
|---|---|---|
| signature | a run holding `w:pict` → `v:shape` → `o:signatureline` | a signature line it can sign |
| initials | plain-text control with a placeholder | a text box; Word has no initials line |
| date | `w:date` control | a date picker |
| text | `w:text` control | a text control |
| checkbox | `w14:checkbox` control | a checkbox |

Checked against `[MS-OE376]` (Office's implementation notes, repo root):

- Office's default for `issignatureline` is **false**, against the standard's
  true (Part 4 §6.2.2.29) — write `issignatureline="t"` or Word sees a picture.
  One `o:signatureline` per shape.
- Word ties a signature to its line by GUID: the signature's `SetupID` matches
  the line's `id`. The line's `id` is a braced GUID, stable for the field.
- **Duplicate `w:id` on two SDTs: Word discards every SDT but the last, keeping
  only its contents** (§2.5.2.18). The exported `w:id` must be unique per field,
  or Word silently strips the metadata the round-trip depends on.
- An inline `sdtContent` holds runs, and a run holds `w:pict`, so a signature
  line inside a content control is schema-valid (§2.5.2.29, §2.5.2.35).
- Word shows a control's placeholder only after the user clicks in and out of
  it (§2.5.2.9) — relevant to 3b.

Not settled by the spec, to verify in real Word before 3d ships: whether Word
still offers *Sign* on a signature line inside a content control, and whether it
needs the line's preview image (`v:imagedata`) or regenerates it.
`w14:checkbox` is specified in [MS-DOCX], not [MS-OE376].

Sub-phases, each its own commit:
**3a** inline field — node, canvas, PDF parity, `listSignerFields`, commands.
**3b** `fieldRange` mark for author text, with Word's placeholder.
**3c** `fieldBlock`.
**3d** DOCX import and export per the mapping above, semantic, markdown.

**Phase 4 — canonical snapshot + hashing.** SHA-256 over canonical semantic
content; sealed field geometry; `artifactHash` over exported bytes. Forces the
determinism contract on `@scrivr/export-semantic`.

Revised 2026-11-11, before building:

- **The hash is over canonical document JSON, not semantic units.** Every node,
  mark and attr, `doc.attrs` included — so headers and footers are covered with
  no extra walk — with keys sorted and no whitespace. Semantic units drop
  formatting (a bold "not" and a plain one hash alike), walk only the body, and
  change as `export-semantic` evolves. The snapshot stores the exact bytes it
  hashed, so verifying later hashes what was stored and never depends on how a
  newer Scrivr would serialize. This also lifts the determinism contract off
  `export-semantic`.
- **No sealed geometry** — see §3, revised.
- **Pending tracked changes refuse the seal**: a signer never agrees to wording
  still marked as a suggestion.

**Phase 5 — revision identity, fencing, fork.** Client contract *and* server
extension together. The largest phase, last, because it is the only one needing
the collaboration extraction.

Revised 2026-11-11, aligned to Seraa. Seraa already owns the seal decision
and record, the lock that orders a seal against a store, a flush-before-seal
message, room auth, per-connection read-only with a 30-second re-check, and
revision storage. Its note bodies run on another editor; Scrivr documents had
no seal at all. Its pattern leaves four gaps, which these close:

| Gap in a host's pattern | Function | Called from |
|---|---|---|
| no hash of what was sealed | `snapshotFromYDoc(ydoc, schema, { assignedRoles })` | the seal, inside the host's lock, after its flush |
| writers keep writing until the re-check | `stampSeal(ydoc, …)` — the seal lives *in the room*, every client sees it on the next sync | the same transaction |
| | `isSealed(ydoc)`, `readRevisionStamp(ydoc)` | `onAuthenticate`, `onStoreDocument` |
| a room's cached state drifts from the seal (post-seal edits reach the cache, then persist on unseal) | `matchesSnapshot(ydoc, schema, contentHash)` + `resetToSnapshot(ydoc, schema, content)` | `onLoadDocument` |
| an unsynced tab's edits are refused and lost | client `Collaboration` seals on the stamp; a mismatch hands the stale document to `onStaleEdits` as a fork | provider wiring |
| | `stampEditable(ydoc, { revisionId, parentRevisionId })` — unseal is a new revision descending from the sealed one | the host's unseal |

Open questions 3 and 4 answered: the snapshot is canonical content alone —
hosts reseed rooms from content, not Y state — and fork lineage lives outside
the document, on the host's revision record, with the stamp carrying only
`parentRevisionId` for clients to see.

## Open questions — answer before building

0. **Decided 2026-11-11 — Scrivr ships functions, not a server extension.**
   The seal must still be enforced on the server, where a patched client
   cannot skip it, but the host owns that server: Scrivr exports pure functions
   — whether an update may land, the state a seal moves a revision to, a fork
   of stale work — and the host calls them from its own HocusPocus hooks, as
   Seraa already gates every body write in one service call. This answers 1
   and 2: no package split is needed to carry a server extension, and there is
   none to place.
1. **Does `@scrivr/collaboration` get extracted?** Collaboration lives in
   `@scrivr/plugins` today. A revision protocol plus a server extension is a
   plausible reason to split it; that is a real cost and should be decided
   deliberately, not smuggled in as a package-table row.
2. **Where does the server extension live?** `apps/server` is a demo. A host runs
   its own HocusPocus; the enforcement must ship as something they install.
3. **Snapshot format.** Y state vector plus canonical content, or canonical
   content alone? Fork needs enough to reconstruct an editable Y.Doc.
4. **Fork lineage in the model** — does `parentRevisionId` live in doc attrs
   (collaborative via `prose_doc_attrs`, `Collaboration.ts`) or outside the
   document entirely?
5. ~~**Partial ceremonies.**~~ **Decided:** no. Every required role is assigned
   before the seal, checked inside `seal()` — see Lane B.
6. ~~**Telemetry granularity and privacy.**~~ **Decided:** page-level only,
   emitted not persisted, storage the host's — see §4.
7. ~~**Does `freezing` need a client-observable state?**~~ **Answered by the
   checks:** yes, and it already has one — `readOnly`. During the drain the
   client must apply remote ops the server accepted before the boundary while
   refusing its own; that is exactly local-denied, remote-allowed.

## Design checks (2026-11-11)

Run against `main` before phase 1, to lock the path. Each finding has already
been folded into the sections above.

**Data flow.** Every document mutation reaches state through one of two
owners: `BaseEditor.applyState` (commands via `dispatchToActive`, input, Yjs and
plugins via `applyTransaction`, `deferEdit`) or `EditorSurface.dispatch`
(header/footer slots, which plugins also call directly). The draft named only the
first. → one `admits` shared by both.

**Invariants.**

| Invariant | Held by |
|---|---|
| A sealed document never changes, from any origin | `admits` at both state owners |
| A read-only viewer still receives remote edits | origin from `COLLAB_SYNC_META`, which core already owns |
| A refused transaction leaves no partial state | judge the full `applyTransaction` result, discard all of it |
| The hash describes everything a reader sees | canonical form includes rendered doc attrs (§3) |
| A field value never enters the document | lane C overlay; the gate makes a value-as-node impossible to write |
| Sealed role assignment matches the sealed fields | `assignedRoles` checked inside `seal()` |

**Error flow.** Every refusal surfaces through the channel its caller already
reads: commands return `false`, `applyTransaction` returns `false`, `deferEdit`
abandons with a reason, and the editor emits `"mutationDenied"`. The one refusal
that would *diverge* state — a sealed client refusing a remote Yjs update while
its Y.Doc keeps it — cannot arise in lane C (no provider) and is closed in lane A
by phase 5 stopping the binding at the seal. Seal failures are typed:
`EpochMismatch`, `UnassignedRoles`, `UnknownRoles`; a retry of a completed seal
returns the original result.

## What shipped

Updated as each phase lands. Where the code and the proposal above disagree,
this section says so rather than the proposal being quietly rewritten to match.

**Phase 1 — mutation gate.** Shipped with this RFC (PR #256).

- `mutationDenial(root, applied, locks)` in `packages/core/src/mutationGate.ts`
  is the one rule. `BaseEditor.applyState` and `EditorSurface.dispatch` both
  apply through it; `SurfaceRegistry` installs the editor's gate on each surface
  at `register()`.
- `editor.seal()` / `editor.sealed`; `readOnly` reads true when sealed, and
  `setReadOnly(false)` does not unseal.
- Origin is `COLLAB_SYNC_META`. `YBinding` now tags its doc-attr sync with it —
  it did not, so a read-only viewer would have refused a collaborator's
  header/footer change.
- `deferEdit` abandons with `"sealed"`; commands return `false` when sealed.
**Phase 2 — sealed viewer (lane C).** Shipped on PR #256.

- `sealed: true` on `Editor` and `ServerEditor`.
- `pagesInView: { first, last, pageCount }` from `TileManager`. `pageCount` was
  added to the design so `reachedEnd` needs no layout read.
- `press: { point, clickCount }` from `PointerController`, primary button only,
  emitted before routing.
- `ReadingProgress` and `FieldCompletion` (+ `setFieldValue`) in
  `@scrivr/plugins` under `sealed-viewer/`. The field manifest types
  (`SealedField`, `FieldValue`) live there until lane B produces them.
- A drawn signature is a raster image, gated by `safeImageUrl`.
- Closing the viewer ends the reading record: `pageLeft` for every page
  still in view.
- Not yet: phases 3–5; keyboard traversal between fields. (Phase 4 replaced the
  manifest's `page`/`rect` with the field's node; see Phase 4 below.)

**Phase 3a — inline field.** Shipped on PR #256.

- `Field` in core, outside StarterKit (first landed as `ContentControl`,
  renamed once the signature-line finding made the model format-neutral). Field listing is the pure
  `listSignerFields(doc)`, not a `BaseEditor` method: the editor would otherwise
  name a node only an opt-in extension defines.
- A field's id is its `nodeId`. `UniqueId` now stamps inline atoms that declare
  `nodeId` as it does blocks, so a pasted field gets a fresh id. Images get ids
  too, as a consequence.
- The insert command refuses a signer field without a role, and an author
  field other than a checkbox. Author text comes in 3b.
- PDF draws the same box as the canvas; the signer outline is solid in the PDF
  because the draw surface has no dash.

**Phase 3b — author text field.** Shipped on PR #256.

- `fieldRange` mark (`nodeId`, `kind: text | date`, `prompt`, `placeholder`),
  in the same `Field` extension. Its id is `nodeId`, the attr document cloning
  already re-keys on marks.
- Behaves as Word's content control: inclusive, so typing at the end stays
  inside; `exitFieldRange` (ArrowRight at the end) steps out; a caret landing
  inside a placeholder selects all of it; typing over it fills the field with
  the same id; deleting just its text brings the placeholder back, while
  deleting it along with surrounding text removes it.
- A copy — paste, or a split — is re-keyed; the run holding the original's
  first character keeps the id. One plugin does this, skipping collaborators'
  transactions and any transaction that touches no field text.
- Placeholder text paints and prints in the placeholder colour, as a default
  fill an author's colour overrides.

**Phase 3c — block field.** Shipped on PR #256.

- `fieldBlock` (`block+`, `layout: { kind: "transparent" }`): its children lay
  out in the page's flow and it draws nothing itself, so canvas and PDF need no
  handler of their own. As a block it gets its id from `UniqueId` unchanged.
- `insertFieldBlock` wraps the selected blocks; `unwrapFieldBlock` lifts them
  out. A block field is always content: wrapping needs blocks to wrap, so it
  has no placeholder state — `prompt` is kept for the DOCX placeholder.

**Phase 3d — DOCX, markdown, semantic.** Shipped on PR #256.

- Export as mapped above. Every control gets a `w:id` unique within the
  export; the signature line carries `issignatureline="t"`, a braced GUID from
  the field id, and the role as `o:suggestedsigner2`. VML and `w14`
  namespaces are declared on the elements, as `Image` does for DrawingML.
- Two seams fixed first, each a defect on its own (`209041ef`): the walker
  wrapped every run separately — a link over mixed formatting became several
  `<w:hyperlink>`, a text field several `<w:sdt>` sharing an id — and now wraps
  a mark's consecutive runs once; import kept one handler per key, so a second
  extension claiming `<w:sdt>` hid `SourcedBlock`'s, and now a declining later
  handler falls through to the earlier one.
- The parser read inline `<w:sdt>` not at all — its text was lost. It now
  yields an `sdt` inline: an `inlines.sdt` handler claims it whole (a field), or
  its content comes in under an `sdt` mark a `marks.sdt` handler claims (a
  text field). A control no one claims keeps its text.
- `getMarkdown()` threw on any document with a field; a field now writes as its
  caption, a text field as its text, a block field as its paragraphs.
- A block field is a `fieldBlock` semantic unit.
- Deferred to after phase 5, by decision: every DOCX check against real Word
  runs once all phases are in, so the live bugs it finds are fixed in one pass.
  To verify then: *Sign* on a signature line inside a content
  control, whether Word needs `v:imagedata` for the line's preview, and Word
  2007's handling of `w14` without `mc:Ignorable`. A content control from a
  document Scrivr did not write keeps its text but is not a field.

**Phase 3e — kinds of field.** Shipped on PR #256, before phase 5 by decision,
so Seraa can retire its own signature extension against a complete set.

- A kind is a `FieldKindSpec`: `label`, `size`, and `control` — one of
  `signatureLine | checkbox | date | dropdown | text`, default `text`. The
  control is what a field *is*: how its box draws, whether an author can tick
  it, how the PDF prints it and what Word receives. Nothing branches on a
  kind's name any more.
- Built-ins add name, email, title, company, number and dropdown to the
  original five. A dropdown carries its own `options` and exports as
  `w:dropDownList`; the parser now reads a control's `w:listItem`s, so its
  choices come back.
- Hosts register kinds with `Field.configure({ kinds })`, over the built-ins.
  A kind with no control of its own exports as a Word text control and imports
  back as itself.
- `listSignerFields` reports any kind name; the registry, not a fixed union,
  decides what can be inserted.
- The registry lives in `fieldKinds.ts`, imported by both `Field.ts` and its
  DOCX handlers, so the two do not import each other.
- Guide: `apps/docs/content/docs/guides/fields.mdx`.

**Phase 4 — snapshot and hashes.** Shipped on PR #256.

- `createSnapshot(doc, { assignedRoles })` → `{ ok: true, snapshot: { content,
  contentHash, fields } }` or `{ ok: false, refusal }`, refusal one of
  `pending-tracked-changes { count }`, `unassigned-roles { missing }`,
  `unknown-roles { unknown }`. A result, not an exception: every refusal is an
  expected answer the host shows to someone.
- `content` is canonical JSON (keys in UTF-16 order, JavaScript's number form —
  RFC 8785's rules for the values a document holds); `contentHash` is
  `sha256:<hex>` over its UTF-8 bytes, by Web Crypto, so it runs in a browser
  and in Node alike. `verifySnapshot(content, contentHash)` and
  `hashArtifact(bytes)` complete it.
- Pending suggestions are counted by id from `dataTracked` records on nodes and
  marks, and from tracked marks, so both the plugin's records and a bare tracked
  mark refuse. Tested against the real TrackChanges plugin.
- `FieldCompletion` takes `snapshot.fields`, finds each field by id in the
  current document, paints inside its box — clipped, over the empty field's
  caption — and hit-tests a press against the same box through
  `getNodeViewportRects` and `getPageScreenPosition`. `SealedField` with its
  `page`/`rect` is gone.
- `revisionId`, `epoch` and `sealedAt` belong to the seal itself — phase 5.

**Phase 5 — the room's revision.** Shipped on PR #256.

- 5a (`c6ec6fef`): `stampSeal`, `stampEditable`, `readRevisionStamp`,
  `isSealed`, `docFromYDoc`, `snapshotFromYDoc`, `matchesSnapshot`,
  `resetToSnapshot` in `@scrivr/plugins`, plus core's `contentHashOf`. The
  stamp lives in its own Y.Map, `scrivr:revision`, guarded on read.
- 5b: `watchRevision`, wired into `Collaboration` as `onSealed`,
  `onStaleEdits`, `onRevision`. The editor seals the moment the stamp arrives;
  whether it holds what was sealed is judged after the room has synced,
  because doc attrs apply only then. `onRevision` fires only on leaving a seal
  — firing it for a room a client simply opens would make a host that
  remounts on it loop.
- The design's "epoch" became the revision id: the stamp, not a counter, is
  what a client compares, and a host's revision ids already order its history.
- Guide: `apps/docs/content/docs/guides/sealing.mdx`, with the hook wiring.

**The executed document.** Shipped on PR #256 — the last link of the chain
sealed revision → snapshot hash → signer values → executed PDF hash.

- The draft's `renderExecutedPdf` became `Field.configure({ values })` on the
  editor that exports: values are printed by the field's own PDF handler, in
  the field's box in that layout, through the kind registry — so a host's
  kinds print right — and a drawn signature is declared as an embed so its
  bytes are fetched before the pages are written. No new exporter API.
- `PdfImageOp` gained `fit: "contain"`: a signature keeps its proportions,
  centred, as the canvas overlay draws it. The exporter knows each embedded
  image's size, so the fit is computed there.
- `FieldValue` moved to core, shared by `FieldCompletion` and `Field`;
  `@scrivr/plugins` re-exports it.

**Dogfooded end to end in the playground.** The content switch gained a
*Signing* demo: an agreement holding every shape of field and one pending
suggestion. An author reviews and fills it, seals it, then signs as each party
in a sealed viewer with `FieldCompletion` and `ReadingProgress`, and downloads
the executed PDF with its hash. Driving it found:

- **Values missing from the executed PDF.** An inline atom is set in the run's
  face only when its strategy measures it; a field did not, so with a font
  provider `fieldPdf` had no face and printed no text. The field strategy now
  measures — returning its authored size — and the box is unchanged. The PDF
  tests had passed because their fixture hand-built a span with a font the
  real layout never gave one; the regression test now lays out a document.
- **A seal over a blank.** An author's text field still showing its prompt
  sealed; a signer would agree to "Client name". `createSnapshot` now refuses
  with `unfilled-fields`.
- **A dropdown a host could not ask for.** `SignerFieldDescriptor` lacked the
  choices. Choices are now `{ id, label }` (`FieldChoice`, a zod schema), on
  the descriptor, and map to `w:value` / `w:displayText` in Word.
- **No sealed mount in React.** `useScrivrEditor` gained `sealed`.
- Paint: values in the theme's text colour (they vanished on a dark page), a
  ticked checkbox keeps its box, no outline left at a completed field's edge.

**Hardened by an outside review.** A second review, read against Microsoft's
content-control and signing documentation, found, each fixed test first:

- **Seals checked the body only.** Headers and footers are documents kept in
  the doc's attributes; the hash covered them but no check did. The seal now
  reads every embedded document: prompts and pending suggestions there refuse,
  and signer fields there refuse with `fields-outside-body`.
- **Word entries were lost on import.** A signer's text in a content control
  came back as an empty field. `importDocx` now returns `fieldValues` beside
  the document; drawings raise `field-drawing-not-imported`.
- **The guide's seal raced incoming updates.** It now blocks writes before the
  snapshot, with recovery, and says what a hash does and does not prove.
- Custom kinds kept their control in the signing view, failed requests reach
  the host (`onFieldRequestError`), and Tab leaves at either end.

**Hardened by a second pre-ship review.** Seven reviewers read everything
since the first; what they found, each fixed test first:

- **The executed PDF was laid out unlike what the signers saw.** Values had
  two owners: the signing view painted its own over boxes of the authored
  width, while the PDF's editor fitted each field to its value, so lines
  re-wrapped. Decided: a field fits its value everywhere, as a Word content
  control does. Values now live in `Field`, beside the document — plugin
  state, so a sealed document takes them — and layout, canvas and PDF all read
  them there; a new value measures the document again
  (`invalidateLayout({ remeasure: true })`). `FieldCompletion` hands what it
  captures to `Field` and takes kinds and party colours from it, instead of
  its own copies.
- **Typed values printed at about half size.** The box was measured to the
  value, then the print size was guessed again at 0.55em a letter. A value is
  now set in the size of the text around it, which the box already fits.
- **Undo did nothing while a field was selected,** when inserting the field
  had replaced text: undo's step looked like typing over the field. History
  transactions pass.
- **An untouched Word checkbox came back answered.** Export writes an unticked
  box as content, so import reported `checked: false` as the signer's. Only a
  tick is an answer now, and a value takes the type its field's kind declares.

Still to do before claiming Word compatibility: open exported files in desktop
Word — signature-line rendering and Sign, fill → save → reopen → re-import for
every control, copied and multiline controls, and what re-export does to
signatures and protection.

**Hardened by the pre-ship review.** Seven reviewers read the whole branch; what
they found, each fixed test first:

- **A sealed client overwrote its room.** The binding recorded a collaborator's
  change as applied even when the sealed editor refused it, so the next click
  wrote the client's older copy back — undoing even a server's
  `resetToSnapshot`. It now records only what the editor accepted.
- **A late joiner lost the room's attributes.** They were held back until
  `markSynced`, which ran after the seal, so they were refused and the client
  reported stale edits it never made. Attributes now land as they arrive, as
  content always did; only the outgoing direction waits for the sync.
- **A click refused in a locked document.** TrailingNode answers any
  transaction on a document ending in a table or rule with a paragraph, so the
  gate refused even selections. The gate now holds the document still while it
  applies a caret move (a `filterTransaction` plugin): the move lands, the
  appended edit does not, and nothing is reported.
- **Seals that skipped their checks.** A signer field with no id, no role or a
  shared id was left out of the manifest — `unidentified-fields` now refuses
  it. Typing at a prompt's edge, or one Backspace, counted as filling it; an
  edit now replaces the whole prompt, as Word does, judged from the
  transaction's mapping rather than the text.
- **A line break split a field** into two with different ids, in the editor and
  in DOCX both ways. A break now belongs to the field's stretch.
- **`ServerEditor.setContent`** replaced a sealed document; `moveNode` reported
  a refused move as done. Both refuse now.
- **The sealing guide's server code** was written against a Hocuspocus API that
  version 2.15 does not have; it now reads the seal from the host's record in
  `onAuthenticate` and makes open connections read-only when it seals.
- Smaller: one value size and one tick shared by screen and PDF; "reached the
  end" waits for a complete layout and measures below the scroll container's
  padding; a host request that throws leaves the field open; Word's own prompt
  in an unowned content control is not imported as text; several owners of
  `<w:sdt>` marks coexist.
