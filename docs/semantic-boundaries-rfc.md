# RFC: Semantic boundaries — subtrees that mean something and render as nothing

Status: draft (2026-08-26)

Prompted by `sourcedBlock` (see [sourced-blocks-rfc.md](./sourced-blocks-rfc.md)),
which turned out to be the first instance of a general shape rather than a
special case. This RFC names that shape and proposes the declarations for it.

## Problem

`sourcedBlock` is structurally real and visually absent. It owns an identity, a
resource, a version, a base hash, a divergence state and a lifecycle
(insert → edit → diverge → update/reset → detach), while the reader only ever
sees the ordinary paragraphs, headings and lists inside it.

It is not alone:

| Node | What the boundary owns | Its own visual box? |
|---|---|---|
| Clause / library entry | source, version, divergence | no |
| Definition entry | term, register, references | no |
| Citation | source ref, locator | depends |
| Generated / AI section | prompt, model, provenance, accept state | no |
| Annotation that owns content | author, thread | no |
| Template region | template id, fill policy | no |
| Document section | numbering restart, page setup | no |
| Exhibit / schedule / party block | legal role, cross-refs | sometimes |
| Callout | kind (info/warn) | **yes** |

Every one of these is: *a contiguous subtree with an identity and a lifecycle,
whose children are ordinary editor content.*

Built one at a time, each invents its own node-name check in the layout walker,
its own containment repair in a normalization plugin, its own clone/paste
identity rule, its own `<w:sdt>` tag sniffing, and its own way of answering
"which one am I inside right now?". We have already written the first copy of
each of those. The second copy is where the cost starts compounding.

## The invariant

> **What a subtree *means* and how it *renders* are independent. Neither may be
> inferred from the other, and neither may be inferred from the node's name.**

The layout half of this landed with `sourcedBlock` (`layout: { kind }`). This
RFC is the other half.

## 1. Three dimensions, three declarations

```text
Node
 │
 ├── Schema      "what may exist inside me?"        ← ProseMirror owns this
 │
 ├── Semantics   "what does this subtree mean?"     ← proposed here
 │
 └── Layout      "how do I occupy the page?"        ← landed
```

They are genuinely orthogonal:

| Node | Semantic boundary | Own layout box |
|---|---|---|
| paragraph | no | yes |
| clause entry | yes | no — transparent |
| definition entry | yes | no — transparent |
| callout | yes | yes |
| table | arguably yes | yes |
| generated section | yes | maybe |

The callout row is the one that proves the two cannot be collapsed into a single
`layoutContainer`-style flag: it is a boundary *and* it paints.

### The declarations

```ts
type NodeLayout =
  | { kind: "block" }        // occupies its own box (default)
  | { kind: "transparent" }; // no box; children join the enclosing flow

type NodeBoundary =
  | { kind: "content" }      // ordinary content (default; never written out)
  | { kind: "boundary"; namespace: string; identityAttr?: string };
```

on the spec:

```ts
sourcedBlock: {
  content: "block+",
  boundary: { kind: "boundary", namespace: "sourced-content", identityAttr: "instanceId" },
  layout:   { kind: "transparent" },
}

callout: {
  content: "block+",
  boundary: { kind: "boundary", namespace: "callout" },
  layout:   { kind: "block" },
}
```

**Naming.** The suggested key was `semantic`. This RFC proposes **`boundary`**
instead, for the same reason decision 2 of the sourced-blocks RFC named the node
`sourcedBlock` and not `semanticBlock`: "semantic" already means *semantic units*
in `@scrivr/export-semantic`, and one word with two meanings in one repo costs us
every future conversation. `boundary` says the thing precisely. This is the one
decision in this RFC that needs an explicit yes/no before implementation.

**`namespace` is opaque to core.** Core knows only that a boundary exists, what
it is called, and where its identity lives. Everything domain-specific — that a
`sourced-content` boundary can be updated from its source, that a `definition`
boundary can be renamed — stays in the extension that declared it. Core must
never grow a switch on namespace.

## 2. What core provides

One reader and a small set of operations over "the boundary I am in":

```ts
nodeBoundary(type): NodeBoundary            // declaration reader, mirrors nodeLayout()

boundaryAt(doc, pos, opts?): BoundaryRef | null   // nearest enclosing boundary
boundariesIn(doc, range?, opts?): BoundaryRef[]   // walk, optionally namespace-filtered
unwrapBoundary(tr, ref): Transaction              // remove the boundary, keep the content
replaceBoundaryContent(tr, ref, fragment): Transaction
selectBoundary(tr, ref): Transaction

interface BoundaryRef {
  node: Node;
  pos: number;
  namespace: string;
  identity: string | null;   // read via identityAttr
  depth: number;             // nesting depth, outermost first
}
```

Each of these already exists once, hand-written, inside `SourcedBlock.ts`:
`detach` is `unwrapBoundary`, `update`/`reset` are `replaceBoundaryContent`,
`collectSourcedBlocks` is a filtered `boundariesIn`, and the divergence walk is
`boundariesIn` plus a hash. Migrating that extension onto the generic operations
is the proof that the abstraction is real — if `SourcedBlock.ts` does not shrink
substantially, this RFC is wrong.

Two more, contributed by the boundary declaration rather than written per
extension:

- **Identity re-mint on paste and clone.** A boundary with an `identityAttr` is
  re-minted by core on both paths. Today `SourcedBlock` ships an
  `addPasteTransforms` and an `addCloneHandlers` implementation that would be
  copy-pasted verbatim by the next boundary type.
- **Empty-shell removal.** "A boundary holding nothing but empty text blocks is
  removed" is a property of boundaries, not of sourced blocks.

## 3. Selection is where this pays off

`addNodeActions` resolves against `SelectionDescriptor.kind`. Today a sourced
block's actions only resolve when the wrapper itself is node-selected — put the
caret inside a clause and the editor cannot tell you which clause you are in.
For a clause library, "what am I inside?" is the primary question a UI asks.

So the descriptor gains the boundary chain:

```ts
interface SelectionDescriptor {
  // ...existing
  boundaries: BoundaryRef[];   // outermost → innermost, [] for ordinary content
}
```

with actions able to declare `when: inBoundary("sourced-content")`. That single
addition turns boundary-aware UI (gutter affordance, breadcrumb, contextual
menu, "select whole clause") into configuration for every boundary type at once.
It also composes with the unified selection work in
[selection-rfc.md](./selection-rfc.md) rather than competing with it: boundaries
are a property the descriptor *reports*, not a new selection kind.

## 4. Containment belongs in the schema

Today nesting is prevented by repair — `appendTransaction` unwraps a
`sourcedBlock` found inside a `sourcedBlock`. With one boundary type that is a
few lines. With six it is a matrix of pairwise rules, applied after the fact, on
every transaction.

ProseMirror can express containment directly through content groups:

```ts
// Ordinary blocks join both groups.
paragraph: { group: "block boundaryContent" }

// A boundary may hold ordinary content, but not another boundary.
sourcedBlock: { group: "block", content: "boundaryContent+" }
```

Then `sourcedBlock → sourcedBlock` is structurally impossible and paste coerces
rather than repairs.

**But blanket non-nesting is wrong at the primitive level.** A callout
containing a clause is legitimate; so is a document section containing anything.
Nesting is only meaningless for a boundary *of the same kind* — nested sourced
blocks make divergence, update and detach ambiguous, which is what decision 6 of
the sourced-blocks RFC was actually about. So containment is a per-declaration
policy:

```ts
boundary: {
  kind: "boundary",
  namespace: "sourced-content",
  nesting: "none" | "foreign-only" | "any",   // default: "foreign-only"
}
```

compiled into content expressions at schema-build time, where ProseMirror can
enforce it, with normalization kept only for what the schema cannot express.

## 5. Consequences elsewhere

- **DOCX.** `<w:sdt>` is the interop carrier for the whole family. A single
  registry keyed by boundary namespace replaces per-extension tag sniffing —
  and removes the failure mode we just hit, where one extension registering an
  `sdt` handler and declining a foreign tag dropped every other content control
  in the document. The 255-character `w:tag` limit becomes one shared concern.
- **`@scrivr/export-semantic`.** Boundaries are natural semantic-unit edges. The
  two concepts are complementary: a boundary is a *subtree in the document*, a
  semantic unit is a *chunk in the emitted stream*. Keeping the words distinct
  (§1) is what lets that sentence be written at all.
- **Track changes / divergence.** Content hashing with a normalizer version is a
  boundary-level concern the moment a second boundary type wants "has this
  drifted from its origin".
- **Comments.** v1 comments are marks and ranges, deliberately
  (`project_comments_headless`). Boundaries are subtrees. A comment that *owns*
  content is a boundary; a comment that *annotates a range* is not. That line
  should stay bright.

## 6. What this does not change

Nothing about ordinary nodes. Absent declarations mean `{ kind: "content" }` and
`{ kind: "block" }`, which is exactly today's behaviour, so no built-in node
needs editing and no consumer schema breaks. The layout algebra shipped with
`sourcedBlock` stands unchanged; this composes with it.

## Decisions to lock

1. **Key named `boundary`, not `semantic`** — collision with semantic units (§1).
   *Needs sign-off.*
2. **`namespace` opaque to core.** No switch on it, ever.
3. **Default is content.** Ordinary nodes declare nothing.
4. **Containment via schema groups, per-declaration policy** — not a blanket
   non-nesting rule, not pairwise normalization (§4).
5. **Identity re-mint and empty-shell removal are boundary properties**, provided
   by core from the declaration.
6. **The descriptor reports boundaries** rather than boundaries becoming a
   selection kind (§3).

## Build order

**Phase 1 — declaration + reader.** `NodeBoundary` on `ScrivrNodeSpec`,
`nodeBoundary()`, `BoundaryRef`, `boundaryAt`/`boundariesIn`. Pure addition, no
behaviour change, fully testable headless.

**Phase 2 — migrate `sourcedBlock`.** Its bespoke detach/update/reset/collect/
re-mint/empty-shell code becomes calls into the generic operations. This is the
proof, and the point at which the file should get materially smaller.

**Phase 3 — selection descriptor.** `boundaries` on `SelectionDescriptor`,
`inBoundary()` predicate for node actions. Sourced-block actions start resolving
from a caret inside the block.

**Phase 4 — containment via groups.** Compile `nesting` policy into content
expressions; retire the nesting normalization rule.

**Phase 5 — shared `<w:sdt>` registry** keyed by namespace, both directions.

**Phase 6 — second consumer** (definitions or citations). Until a second type
exists, this is a well-argued theory; the second type is what tests it.

Phases 1–3 are the abstraction. 4–6 are what it buys.

## Open questions

- **Do boundaries nest in practice, and what does "the" boundary mean when they
  do?** §4 says nesting is legitimate across kinds, which makes `boundaryAt`
  return a chain rather than a node. Every operation then has to say which depth
  it means. Defaulting to innermost is probably right, and probably not always.
- **Fragments across pages.** A transparent boundary already splits across pages
  freely; fragments carry the instance id for gutter placement. That contract
  needs to be stated once at the boundary level rather than re-derived per type.
- **Does a boundary need a stable identity at all?** A callout arguably does not.
  `identityAttr` is optional above, but if identity turns out to be what makes
  the generic operations useful (registries, cross-references, re-mint), the
  optionality may be a false economy.
- **Undo granularity.** `unwrapBoundary` must be one undo step; so must
  `replaceBoundaryContent`. Worth asserting in Phase 2 rather than discovering
  in a consumer.
