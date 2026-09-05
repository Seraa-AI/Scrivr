# Format Lane Ownership RFC — an extension owns every lane its node crosses

## Direction

An extension is meant to be the single place that says what a node is: its
schema, its layout, how it paints, how it survives the clipboard, and how it
travels through every file format. Four of the five format lanes already work
that way. PDF does not, and the reason it does not is a dependency direction
nobody has paid off.

This RFC decides where the PDF contract lives, what a mark contributes, why
moving handlers is not by itself ownership, and what stops the next lane from
rotting the same way.

It is a direction change, not a feature. Nothing here ships until it is agreed.

## Where we actually are

| Lane | Contract lives | Handlers registered by | Dispatch routes through registration |
|---|---|---|---|
| DOCX export | core (`exports/docx.ts`) | 20 extensions | yes |
| DOCX import | core (`exports/docx.ts`) | 16 extensions | yes, except `hardBreak` (see below) |
| Semantic | core | extensions, via `addExports().semantic` | yes |
| Markdown | core | extensions, via `addMarkdownSerializerRules()` | yes |
| **PDF** | **`@scrivr/export-pdf`** | **2 extensions** (`Table`, `HeaderFooter`) | **partly — see §4** |

Eight node types and five mark behaviours are implemented inside the PDF
package rather than on the extensions that define those nodes:

- `packages/export-pdf/src/defaults.ts` — `paragraph`, `heading`, `bulletList`,
  `orderedList`, `listItem`, `codeBlock`, `horizontalRule`, `image`
- `packages/export-pdf/src/context.ts:166-200` — `underline`, `link`,
  `strikethrough`, `highlight`, branched on by name inside the painter
- `packages/export-pdf/src/context.ts:299` and `:348-358` — `color`, which is a
  *fill* rather than a decoration and so lives in a different function. That
  asymmetry is why §3 needs colour precedence as its own rule.

Two DOCX import gaps are worth recording while inventorying lane health, though
neither is this RFC's subject. `hardBreak` is read by the package
(`docx/src/import/transform.ts:153`) rather than by its extension. And `Link`
declares no `addImports()` at all, so a `hyperlink` mark is parsed
(`docx/src/import/parser.ts:438`) and then dropped with an `unsupported-mark`
diagnostic — a silently lost hyperlink on every DOCX import.

## Non-goals

- **A shared display list** consumed by both the canvas renderer and PDF. It
  would remove real duplication, but it is a renderer redesign with a far larger
  fidelity surface than this. Revisit once PDF ownership is settled.
- **Changing any rendered output.** Every phase here is behaviour-preserving
  except the one exception stated in §7.
- **Font substitution from an extension.** Layout already resolved the font and
  measured against it; letting export swap it invalidates measured positions.
- **The remaining DOCX import gaps** (`hardBreak`, and `Link`'s missing
  `addImports()`). Same principle, different lane, no shared risk — a follow-up.
  Note `list` is *not* one of them: `docx/src/import/transform.ts:92-94` argues
  the case explicitly — reading a list is `bulletList`/`orderedList`/`listItem`
  construction with nothing per-extension to decide. That is a stated decision,
  not drift, and this RFC does not overturn it.

## 1. Why PDF is stuck

Core must not import `pdf-lib`; that would put a rendering backend in the
document model and give every consumer of `@scrivr/core` a PDF dependency.

`Table` worked around it with a structural interface local to one file:

```ts
// packages/core/src/table/pdfExport.ts
interface PdfContextLike {
  layout: { pageConfig: { pageHeight: number } };
  page: { drawLine(...): void; drawRectangle(...): void };
  draw: { lines(block: LayoutBlock, ctx: unknown): void };
}
const BORDER_COLOR = { type: "RGB", red: 0.612, green: 0.639, blue: 0.686 };
```

It works. But it is worth being honest about what it is: `{ type: "RGB", red,
green, blue }` is pdf-lib's `Color` shape, hand-copied; `PT_PER_PX` is pdf-lib's
coordinate system, hand-applied. **Avoiding the import did not produce an
abstraction — it produced an untyped copy of the same API.**

And the drift is not a prediction. There are already two `PdfContextLike`
declarations, and they do not agree:

| | `core/src/table/pdfExport.ts:30` | `plugins/src/header-footer/pdfExport.ts:27` |
|---|---|---|
| page ops | `drawLine`, `drawRectangle` | `drawText` |
| fonts | absent | a registry |
| position | absent | `x`, `y`, `width` |

Same name, incompatible shapes, no compiler relation between them. Two copies
have already diverged; eleven more would diverge eleven more ways.

The contract genuinely leaks the backend, too. `PdfContext`
(`packages/export-pdf/src/context.ts:34`) exposes four pdf-lib types directly:

```ts
doc: PDFDocument;
page: PDFPage;
fonts: PdfFontRegistry;          // resolve(cssFont): PDFFont
images: Map<string, PDFImage | null>;
```

So "move the handlers into core" is not a small change. It requires deciding
what a handler is allowed to see.

## 2. Decision — the contract lives in core, and it is a drawing surface

**Core owns the vocabulary; the format package implements it.** This is exactly
what DOCX already does, and the dependency direction is identical — core defines
`DocxNodeHandler` / `DocxImportContext` and `@scrivr/docx` implements them
against real OOXML. PDF differs only in that the capability is *drawing* rather
than *XML construction*.

New file `packages/core/src/exports/pdf.ts` defines:

- **Colour** as `{ r, g, b, alpha? }` with documented ranges (0–255, 0–1) —
  reusing `Rgb`/`Rgba` from `model/cssColor.ts`, which already exist and are
  already what the canvas, DOCX and PDF lanes agree on.
- **Coordinates** in layout pixels, top-down, matching every other lane. The
  exporter owns the flip to PDF points. No handler multiplies by `PT_PER_PX`.
- **Fonts** as the CSS font string layout already resolved, or an opaque handle.
  Never a `PDFFont`.
- **Primitives**: `text`, `line`, `rect`, `image`, `imagePlaceholder`.
- **Block dispatch**: the capability described in §4, so a handler can render
  its children without knowing who owns them.

The type is `PdfDrawingSurface`, and it stays PDF-named on purpose. Nothing in
the primitive list is especially PDF-specific, so a generic `DrawingSurface`
would read as a promise that canvas will use it too — a promise this RFC
explicitly declines to make. If canvas and PDF converge later, the common
abstraction gets extracted then, from two real implementations rather than one
guess.

`@scrivr/export-pdf` implements this surface over pdf-lib and re-exports the
core types so today's imports keep working.

**Rejected — B, a types-only package.** It adds a package and a version to
coordinate for no independent consumer. These contracts already depend on core's
layout types, so the new package would depend on core anyway, and factoring that
without a cycle is work we would be doing to avoid work.

**Rejected — C, the status quo.** Per-file structural types are duplicated,
weakly checked API maintenance. We have one copy today and it already drifted
into hand-copied pdf-lib shapes.

## 3. Decision — marks are declarative, with explicit precedence and paint phase

There are no mark handlers to move. `defaultMarkHandlers` is
`Record<string, never> = {}` — and `index.ts:132` feeds that empty table into
the painter. There are five behaviours hard-coded instead, and a typed seam that
has never been connected (§5).

A mark handler returns a style; the painter owns all geometry — baselines,
thickness, span width, coordinate conversion. A highlight extension should not
know where a baseline is.

**A handler returns contributions, not a style object to merge.** This is the
part that a flat `PdfSpanStyle` cannot survive:

```ts
interface PdfMarkContribution {
  foreground?: { color: Rgb; source: MarkSource };
  backgrounds?: Array<{ color: Rgba; phase: PaintPhase }>;
  decorations?: Array<{ kind: "underline" | "strikethrough"; color: Rgb | "text"; source: MarkSource }>;
}
```

Object merging destroys exactly the two things that are observable today:

- **Provenance.** An explicit `color` mark beats the link colour for *text*
  (`context.ts:348-358`), while a link's *underline* still uses `theme.link`
  (`:171`). Merged into one `color` field, that distinction is gone.
- **Multiplicity.** A span carrying both `link` and `underline` draws **two**
  lines (`:166-178`, non-exclusive `if`s). A merged `underline?: boolean` draws
  one.

The painter resolves the contributions and owns all geometry.

One deviation from the reviewed sketch: precedence is a **named rule keyed on
`source`**, not a `priority: number` the handler picks. A number invites
extensions to escalate against each other, and the arbitration then lives
nowhere. The rule — explicit `color` beats link for text fill; link owns its own
underline colour — belongs in the painter, written down once.

That last one is load-bearing and easy to get wrong:

> `context.ts` draws text at `:301` and decorations at `:309`. The highlight
> rectangle is drawn **after** the text, at `opacity: 0.4`.

A declarative `backgroundColor` applied before text — the obvious reading — puts
the text under a 40% wash instead of over it, changing every highlighted
document. The contract therefore names the phase explicitly:

```ts
type PaintPhase = "beforeText" | "afterText";
```

`beforeText`/`afterText` rather than `under`/`over`, because *under what?* — the
list will grow (selection, annotation overlays) and the names should keep saying
what they order against. The migration preserves `afterText`. Whether that is
the *right* rendering is a separate question with its own before/after.

## 4. Decision — ownership is a dispatch property, not a file location

Moving thirteen behaviours into extensions does not establish the rule, because
several paths never consult the registration at all:

| Path | Today |
|---|---|
| Inline object spans | `context.ts:260`/`:262` draw the image directly; `nodeHandlers[...]` at `:266` is only the fallback |
| Anchored objects | `index.ts:190` and `:215` call `drawPdfAnchoredObject`, whose own comment at `:236` says it plainly: *"not dispatched — part of core pipeline"* |
| Table cell children | `table/pdfExport.ts` renders them via `ctx.draw.lines`, bypassing their own node handlers |
| Header/footer bands | same, through the chrome payload |
| Image collection | `embedImages` (`index.ts:303`) understands image nodes *and* reaches into the chrome payload through an inline `as` cast the repo's rules forbid |

So an `Image` extension could own `nodes.image` and still not be the thing that
draws an inline or anchored image.

**The RFC's answer:** one block-dispatch capability on the context, used by the
body loop, by nested content, and by chrome.

### The lane ownership invariant

> For any extension-defined node or mark participating in a format lane, all
> semantic rendering behaviour for that value must enter the lane through that
> extension's registered contribution.
>
> The lane may own traversal, placement, batching, asset preparation, coordinate
> conversion and backend implementation. **It may not branch on
> extension-defined semantic names to reproduce their rendering behaviour.**

That last sentence is the one that has to be written down. Everything this RFC
removes was added by someone solving a real problem — a new anchored-image bug is
fixed in ten seconds with `if (node.type.name === "image")`, and the architecture
quietly regrows. The conformance fixture (§5) catches a *disconnected* lane; it
does not catch a lane that has been re-implemented beside itself. The rule does.

Stated as layers:

```
Layout      owns geometry
Pipeline    owns traversal, placement and ordering
Extension   owns semantic rendering
Backend     owns device primitives
```

Worth noting for scope: **six of the eight default node handlers are exactly
`ctx.draw.lines(block, ctx)`**. Extension ownership mostly means *selecting the
shared primitive*, not reimplementing a renderer. The migration is smaller than
the handler count suggests.

Asset discovery needs its own owner too — see open question 2.

## 5. Decision — a lane conformance fixture, because types only check shape

`PdfExports.marks` is typed, documented as *"Per-mark inline styling, keyed by
mark.type.name"*, and:

- never collected — `index.ts:99-105` reads `nodes`, `chrome`,
  `onBeforeExport`, `onAfterExport`
- never consulted — `createDrawHelpers` takes `markHandlers` and the identifier
  appears exactly once in `context.ts:96`, its own declaration

An extension can ship `pdf: { marks: {…} }` today. It type-checks. It does
nothing, silently. That is worse than an absent seam, because the type says the
feature exists.

Three mechanisms, in increasing strength:

1. **Compiler, free.** `noUnusedParameters` would have flagged `markHandlers`
   the day it was written. Enable it.
2. **Structural, cheap.** Declare collection policy as
   `satisfies Record<keyof PdfExports, CollectionPolicy>`, so adding a field to
   the contract forces a decision about collecting it. This proves collection,
   not consumption.
3. **Executable, the one that actually works.** A synthetic extension driven
   through real registration → contribution collection → export, with one
   *observable* effect per lane: a node handler that emits identifiable output,
   a mark handler that changes a colour, a chrome handler, an awaited lifecycle
   hook. Assert the output and the hook ordering. Then disconnect collection
   once by hand and confirm the fixture fails.

Require the fixture for every new lane — and state it as a law rather than a PDF
chore:

> For every contribution surface an extension can declare, there is an
> integration test proving **define → register → collect → consume**.

That is stronger than testing PDF. The dead `marks` seam is not a unit-test
failure; it is an architectural-testing failure, and the same shape can occur in
any lane. Registration counts and coverage percentages would both have passed
while `marks` was dead.

One correction while we are here: the comment at
`packages/core/src/extensions/export.ts:17-20` claims that when no format package
is loaded, the return type "makes it impossible to add a key without a format
package imported (type-safe)". TypeScript's `{}` is not an exact empty-object
type, so that guarantee does not hold. Contribution typing should be explicit
rather than relying on it.

## 6. Fidelity strategy — capture the output before touching the dispatch

The existing suite cannot catch a paint-order or geometry regression. It does
cover some rendering — `buildPdf.test.ts:481` catches a centring regression,
`textColor.test.ts` covers colour resolution — but there are three test files in
total, and the closest thing to a byte comparison asserts **inequality**:

```ts
// themedExport.test.ts:114
expect(byteEquals(defaultBytes, darkBytes)).toBe(false);
```

That proves a themed export differs from an unthemed one. Unrelated metadata
would satisfy it.

**Primary gate: an ordered drawing-operation baseline.** Record every call at
the backend boundary — operation, coordinates, colour, opacity, font identity,
order — and diff against a baseline captured from today's implementation. It
catches paint-order and phase changes (§3) directly, which is the failure this
migration is most likely to produce, and it needs no pinned renderer.

Numbers go through one `normalizeDrawNumber` before they are recorded. Without
it the baseline eventually fills with `41.9999999998` diffs from arithmetic
reassociation, and a harness that cries wolf gets ignored — which is the same
failure as not having one. The normalisation is part of the harness contract,
not a detail of it.

**Characterization fixtures** covering all eight node registrations and five
mark behaviours: combined marks on one span, justified and positioned text,
a block continuing across pages, image present and image missing, table shading
and merges, header/footer tokens.

**Deliberately not doing:** raw PDF byte snapshots as the gate (they move for
reasons unrelated to rendering), every Cartesian mark combination, retesting
pdf-lib primitives, or thirteen tests asserting "handler calls helper". A
rendered-page pixel corpus is deferred: pinned renderer, fonts, locale and clock
are a lot of infrastructure, and the op-log carries most of the signal. Add it
only if the op-log proves insufficient.

## 7. Behaviour changes we accept

Everything else is behaviour-preserving.

**Contributed PDF mark handlers start working.** They are silently dead today,
so an extension that registered one gets the rendering it already asked for.

That makes precedence a real decision, not a detail: during Phase 2 a contributed
handler and a built-in behaviour can both claim `link` or `highlight`.
**Contributed wins** — owning the lane is the point, and the built-ins are being
deleted by the end of Phase 4 anyway, so the ambiguity is transitional.

The highlight paint phase, decoration order, colour precedence, and coordinate
rounding are all preserved as-is. If any of them is wrong, it gets its own change
with its own before/after.

## 8. Phases

Each is independently reviewable and shippable.

| Phase | Work | Gate |
|---|---|---|
| **0** | Op-log harness + characterization fixtures; capture baselines from today's output | **Mutation-proven:** flip the highlight phase to `beforeText`, reorder the `link`+`underline` pair, and drop `opacity: 0.4` — each perturbation must produce a failing diff. A harness diffed against a baseline it generated is green by construction, so "green" is not evidence |
| **1** | `core/src/exports/pdf.ts` — the drawing surface; adapter in `@scrivr/export-pdf`; re-export for compatibility. No handler moves | Op-log identical |
| **2** | Mark lane: collect `marks`, consult them in the painter, move the five behaviours to their extensions | Op-log identical |
| **3** | Dispatch repair: one block-dispatch capability; inline objects, anchored objects, table children and chrome rendering all route through it. Handlers have not moved yet, so this is pure routing | Op-log identical |
| **4** | Node lane: move the eight handlers to their six extensions; `defaults.ts` empties. Every route already obeys dispatch, so this is mechanical | Op-log identical |
| **5** | Enforcement: conformance fixture, `noUnusedParameters`, collection-policy `satisfies`, forbidden-import check in core | Fixture fails when a lane is disconnected by hand |

Phase 4 is where both `PdfContextLike` copies are deleted in favour of the core
contract.

**Dispatch is repaired before the handlers move**, which is the reverse of the
obvious order. Moving handlers first would give us a phase where `Image` owns
`nodes.image` while inline and anchored images still bypass it — the repository
would assert an ownership it does not have, which is the exact confusion this
RFC exists to end. Repairing routing first is also a purer change: it touches no
handler, so the op-log is the whole test.

## Open questions

1. **Font representation.** A CSS string re-resolved per draw, or an opaque
   handle the exporter mints? Leaning handle: no backend type leaks, no repeated
   parsing, stable identity in the op-log, and the backend keeps control of
   caching. The condition is that it stays **opaque** — the moment it exposes an
   `.internal`, the dependency leak is back with extra steps. Decide in Phase 1.
2. **Asset discovery ownership.** Proposed: the extension *declares* the assets
   a node references, export preparation resolves and embeds them, and the
   handler receives an **opaque handle** — never a `src` it has to fetch.

   ```
   Extension  → declares asset references
   Preparation→ resolves, embeds, dedupes, handles failure
   Handler    → receives a handle
   Backend    → renders the embedded asset
   ```

   Otherwise a node renderer inherits network access, caching, deduplication and
   failure policy, which is how a handler becomes a miniature exporter. It also
   gives inline, anchored, table-cell and chrome images one path instead of four.
   Open because the handle's lifetime and the failure surface still need
   settling — and because today's `embedImages` reaches into the chrome payload
   through an `as` cast this repo forbids, so it does not survive either answer.
3. ~~**Does chrome get the same treatment?**~~ **Resolved:** chrome comes under
   the rendering rule but not the placement rule. `HeaderFooter` owns what a
   header *looks like*; the pipeline keeps the header region, the repetition,
   the odd/even parity and the page-number resolution. That is the §4 layering
   applied to chrome rather than an exception to it, so Phase 3 includes chrome
   rendering.
4. **Is canvas a lane for §5's rule?** The conformance fixture is written for
   format lanes. Canvas painting is extension-owned through `BlockStrategy` and
   the overlay handlers, and CLAUDE.md already requires canvas↔PDF↔DOCX parity —
   so the question is whether the fixture should assert that too, or whether
   parity stays a review-time rule.

## Files to create / modify

**Create**
- `packages/core/src/exports/pdf.ts` — the drawing surface and handler contracts
- `packages/export-pdf/src/__tests__/opLog.ts` — recording harness
- `packages/export-pdf/src/__tests__/laneConformance.test.ts` — the fixture

**Modify**
- `tsconfig.base.json` — enable `noUnusedParameters` (set nowhere today; this is
  a nine-package blast radius and wants its own commit)
- a forbidden-import check with a named home — an eslint rule in the repo's
  config, or dependency-cruiser if we would rather not grow the eslint surface.
  Decide in Phase 5; the rule is "core must not import a rendering backend"
- `packages/export-pdf/src/augmentation.ts` — re-export core contracts
- `packages/export-pdf/src/context.ts` — implement the surface; painter consults mark handlers
- `packages/export-pdf/src/index.ts` — collect `marks`; route dispatch
- `packages/export-pdf/src/defaults.ts` — empties over Phases 2–3
- `packages/core/src/table/pdfExport.ts` — drop `PdfContextLike` for the core contract
- `packages/core/src/extensions/export.ts` — correct the `{}` comment
- Six extensions gain `addExports().pdf.nodes`; five gain `.marks`

## Dependencies

None outstanding. `packages/core/src/model/cssColor.ts` already gives every lane
one colour vocabulary, and `DocxImportContext.walkBlocks`
(`packages/core/src/exports/docx.ts:573`) is the precedent for a context
capability that lets a contribution recurse without owning dispatch.
