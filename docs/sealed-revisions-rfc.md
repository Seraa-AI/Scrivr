# RFC: Sealed Revisions

Status: draft (2026-09-28)

## Problem

An application built on Scrivr needs to say, and be able to prove, *this exact
document is what was agreed*. Signing ceremonies need it. So do regulatory
submissions, board approvals, published releases and anything that produces an
executed artifact.

Scrivr today cannot say it. Three gaps:

**1. Read-only is not a mutation boundary.** `readOnly` gates two paths — the
command wrapper (`BaseEditor.ts:581`, early-returns every command) and the input
bridge (`Editor.ts:778`, `ib.setReadOnly` + cursor stop). It does *not* gate
`applyTransaction` (`BaseEditor.ts:328`), whose own doc comment names its
callers: "plugin metadata via `tr.setMeta()`, programmatic `deleteSelection`,
custom transforms, or external sources (Y.js remote sync, AI suggestions)". A
read-only Scrivr editor accepts remote Yjs updates and agent-generated
transactions today. That is a live bug independent of this RFC.

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

One chokepoint. `applyState` — reached by `applyTransaction`, by
`dispatchToActive`, and by the command wrapper — classifies and decides.

```ts
type MutationPolicy = {
  content: "allow" | "deny";
  selection: "allow" | "deny";
};
```

Two axes, because `tr.docChanged` is the only honest discriminator ProseMirror
gives us. A predicate form (`canApply(tr): boolean`) is rejected: arbitrary
predicates are untestable, unpredictable when composed, and every extension will
want to install one.

`readOnly` becomes a **derived read** of the policy, not a second flag. The repo
already carries one recurring papercut from two owners of a single fact (the
selection resolver, `docs/selection-rfc.md`); a `readOnly` boolean living beside
a `MutationPolicy` would be the second.

A denied transaction is dropped and reported — the host needs to know a seal
rejected an edit, not discover it by the document silently not changing.

**This lane is independently valuable.** It fixes the `applyTransaction` hole
whether or not anything downstream ships.

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

Two consequences:

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

Lane C therefore exposes a viewport telemetry surface — pages entered, dwell,
furthest point reached — that the host subscribes to and writes into its own
evidence store. This is a Scrivr responsibility falling directly out of the
rendering architecture.

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
const sealed = await revisions.seal(documentName, { expectedEpoch });
// { revisionId, epoch, snapshot, contentHash, sealedAt, fields }
```

- **`fields` returns *from* the seal.** Reading them in a separate prior call is
  a TOCTOU — a drafter adds a signature block between the read and the freeze and
  the ceremony is missing a signer. The manifest and the hash must be atomic.
- **Idempotent by `revisionId`.** A backend will retry across a network blip;
  sealing an already-sealed revision returns the same result rather than throwing.
  An `expectedEpoch` mismatch is the only real failure, and it means "someone
  edited after you decided to freeze" — the host shows a diff and asks again.

**Lane C — consumption.** No provider, no Y.Doc.

```ts
new Editor({
  content: snapshot,
  revision: { id, contentHash },        // sealed → content: "deny"
  extensions: [FieldCompletion.configure({
    fields,                              // what THIS viewer may complete
    values,                              // already completed by others, for display
    onFieldComplete: (id, value) => Promise<void>,
  })],
});
```

`onFieldComplete` returning a promise is the seam: the host authenticates,
captures consent, writes evidence, and resolves — or rejects, and Scrivr reverts
the overlay. Scrivr persists nothing.

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

**Phase 1 — mutation gate.** Core only. One chokepoint in `applyState`,
`readOnly` derived from the policy, `content`/`selection` axes, denied
transactions reported. Ships alone, fixes a live bug, no dependents.

**Phase 2 — sealed viewer (lane C).** A sealed editor over a static snapshot with
an external value overlay and viewport telemetry. **Deliberately before lanes A
and B**: an entire ceremony can be built and demoed against a hand-made snapshot
with no collaboration involved. If "values are never nodes" survives that, every
decision downstream is de-risked. If it does not, we learn it for the cost of a
viewer.

**Phase 3 — field definitions (lane A).** The authoring extension. Carries a
format obligation from day one — canvas *and* PDF (`feedback_pdf_parity`), plus
its own import/export handlers (`todo_extension_owned_format_paths`). Answer the
`<w:sdt>` question first (`todo_form_fields_content_controls`): OOXML content
controls serve forms *and* templating, and if signature fields are the same
feature we should not build two.

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
5. **Partial ceremonies.** Can a revision seal with unassigned roles? Probably
   yes — assignment is the host's — but `required` then means nothing to Scrivr.
6. **Telemetry granularity and privacy.** Page-level is defensible; paragraph
   dwell is surveillance. Where is the line, and is it the host's to set?
7. **Does `freezing` need a client-observable state at all,** or is the drain
   short enough that `editable → sealed` with rejected-update feedback is the
   whole story?

## What shipped

Updated as each phase lands. Where the code and the proposal above disagree,
this section says so rather than the proposal being quietly rewritten to match.

*Nothing yet — draft.*
