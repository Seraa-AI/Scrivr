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

### Field geometry is sealed, not re-derived

A viewer shows a field at a coordinate; the executed PDF must paint its value at
the same coordinate. Both derive from the layout engine over the same snapshot —
identical only if fonts resolve identically, which across a signer's browser and
a render server they will not.

Resolve it by computing field geometry **once, at seal time**, and carrying it in
the snapshot. Field placement becomes an immutable property of the sealed
revision rather than something re-derived per surface. This is smaller than
pinning font bytes and it is the more honest model: where the signature goes was
decided when the document was frozen.

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
    fields,                              // sealed manifest: id, role, kind, required, page, rect
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

**Phase 5 — revision identity, fencing, fork.** Client contract *and* server
extension together. The largest phase, last, because it is the only one needing
the collaboration extraction.

## Open questions — answer before building

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
- Not yet: phases 3–5; keyboard traversal between fields.

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
