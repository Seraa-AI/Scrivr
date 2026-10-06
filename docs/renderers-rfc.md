# Rendering and Serialization Registration RFC

> Status: proposed design, not implemented. Consolidates visual output under
> `addRenderers()` and document conversion under `addSerialization()`, retaining
> target-specific contracts. Revises the initial draft that placed every output
> under addRenderers. Companion to
> [format ownership](./format-lane-ownership-rfc.md),
> [export extensibility](./export-extensibility.md), and
> [resumable layout](./resumable-layout-rfc.md).

> **Renderers paint layout. Serialization reads and writes document content.
> An extension owns both, with one typed registration hook for each concern.**

## 1. Problem and intended result

Today the Table extension registers its canvas row strategy through
`addLayoutHandlers()` and its PDF, DOCX, and semantic handlers through
`addExports()`. Markdown serialization is another hook. Canvas is treated as
special even though it is another output of the same extension-owned content.

The name `addLayoutHandlers()` also obscures its role: its `BlockStrategy.render`
paints an already-laid-out block and populates character geometry. It does not
implement paragraph measurement or pagination.

Use two intuitive questions to choose a hook:

- "How does this look after layout?" → `addRenderers()` (canvas, PDF).
- "How is this document content represented or read in a format?" →
  `addSerialization()` (HTML, Markdown, DOCX, semantic data).

Within serialization, keep each format's `serialize` and `parse` contributions
together. Either direction is optional. This collapses the current export,
import, Markdown serializer, Markdown parser, and embedded HTML registration
surfaces without forcing their engines to use a universal handler signature.
It does not claim all formats round-trip losslessly.

Classify by INPUT and purpose, not file extension or whether the result is
bytes. PDF belongs with renderers because Scrivr paints layout into it. DOCX
belongs with serialization because Scrivr preserves editable document intent
and Word computes its layout. Semantic output is a one-way structured projection
of content and fits the serialize side; no inverse parser is implied.

Registration unification alone does not remove duplicated painting rules.
Canvas and PDF handlers should be able to call shared geometry-based painting
helpers. The first example is table borders: both current painters independently
decide to omit a top border for `vMerge === "continue"` and draw a bottom border
only for the last row.

## 2. Target registration API

Illustrative proposed declaration; existing handler implementations can be
adapted before their internals change:

```ts
addRenderers() {
  return {
    canvas: {
      nodes: { tableRow: TableRowStrategy },
    },
    pdf: {
      nodes: { tableRow: renderTableRowPdf },
    },
  };
}

addSerialization() {
  return {
    html: {
      serialize: {
        nodes: tableDomSerializers,
        finalizeDOM: [collapseRowSpans],
      },
      parse: {
        nodes: tableDomParseRules,
        prepareDOM: [expandRowSpans],
      },
    },
    markdown: {
      serialize: { nodes: tableMarkdownRules },
    },
    docx: {
      serialize: { nodes: tableDocxExportHandlers },
      parse: { blocks: tableDocxImportHandlers },
    },
    semantic: {
      serialize: { nodes: { table: tableSemanticHandler } },
    },
  };
}
```

The named rule maps above are placeholders illustrating registration, not
existing exports. collapseRowSpans/expandRowSpans are existing helpers; their
finalizeDOM/prepareDOM registration is proposed. Markdown table serialization
already exists, but this example does not invent a matching parser. A format's
parse contribution is omitted when no supported parser exists. `serialize` and `parse`
contain format-specific handler bundles; they are not required to be single
whole-document functions with a common signature.

`TableRowStrategy` can retain its existing object-shaped contract initially;
other targets retain their own handler signatures. A uniform registration
shape does not require a uniform callable signature.

| Target | Input | Output |
|---|---|---|
| Canvas | Layout blocks/fragments, render context | Screen paint and existing character-map integration |
| PDF | Layout blocks/fragments, export context | PDF paint |
| DOCX | Document nodes, styles, semantic settings | Editable OOXML structures |
| Semantic | Document nodes and semantic context | Semantic units/representation |
| HTML | Document nodes/marks or DOM input | DOM/HTML structure or parsed document content |
| Markdown | Document nodes and serializer state | Markdown text |

DOCX and semantic handlers must not consume paginated fragments. A table split
across three screen pages remains one semantic table. HTML in this proposal is
document/clipboard serialization, not an HTML/CSS replica of paginated canvas
output. A future DOM painter would be a distinct renderer target.

Extensions declare only the targets and directions they support. There is no
automatic canvas-to-DOCX/PDF fallback and no requirement to load a backend merely
to register its handlers. Unsupported-content policies remain explicit per
target. Existing public export/import functions can keep their names; this
proposal reorganizes extension declarations, not every end-user operation.

## 3. Scope of consolidation

| Existing hook | Proposed destination or boundary |
|---|---|
| `addExports().pdf` | `addRenderers().pdf` |
| `addExports().docx` / `.semantic` | `addSerialization().<format>.serialize` |
| Custom `addExports()` targets | Explicitly classify as visual renderer or document serialization; preserve legacy routing until migrated |
| `addLayoutHandlers()` | `canvas.nodes` |
| `addMarkDecorators()` | `canvas.marks` |
| `addInlineHandlers().render` | `canvas.inline` |
| `addMarkdownSerializerRules()` | `addSerialization().markdown.serialize` |
| `addMarkdownParserTokens()` | `addSerialization().markdown.parse.tokens` |
| Node/mark `toDOM` | `addSerialization().html.serialize.nodes` / `.marks`, compiled into schema specs |
| Node/mark `parseDOM` | `addSerialization().html.parse.nodes` / `.marks`, compiled into schema specs |
| Table expandRowSpans / collapseRowSpans | HTML parse.prepareDOM / serialize.finalizeDOM structural transforms |
| `addPageChrome().render` | `canvas.chrome`, keyed by contributor name |
| `addPageChrome().measure` | Stays in layout contribution registration |
| `addInlineHandlers().measure` and alignment used by layout | Stay in a separate inline-layout contribution |
| `addBlockStyles()` / `addFontModifiers()` | Stay with formatting and measurement |
| `addImports().docx` | `addSerialization().docx.parse` |
| Other import formats | Corresponding serialization parse slots with typed adapters |
| General paste transforms, HTML cleanup, Markdown detection, typing input rules | Stay with input policy; format-specific structure conversion can move to its serialization bundle |
| Selection, gestures, surfaces, editor lifecycle | Keep their existing ownership |

Canvas bundles need typed slots for block strategies, inline painters, mark
decorators, and page chrome. They do not need to mimic the PDF bundle exactly:
PDF currently routes inline objects through its node handlers. Preserve that
working dispatch contract rather than adding an unused PDF inline registry.

The inline hook is currently mixed: measurement, vertical alignment, and paint
live on one InlineStrategy. Its migration must explicitly split those roles.
Do not make headless layout load a canvas renderer to measure an inline atom.
An interim compatibility adapter may expose the old combined interface to
existing consumers while sourcing measurement and painting separately.

Page chrome has the same issue. Header/footer measurement remains part of
iterative layout. Only painting moves into renderer registration. Preserve
contributor names, measured payloads, and their validation across the split.
The migration must not invoke measurement again merely to paint a page.

### HTML must have one source of truth

HTML currently lives in ProseMirror NodeSpec/MarkSpec `toDOM` and `parseDOM`.
ClipboardSerializer calls DOMSerializer.fromSchema; PasteTransformer calls
DOMParser.fromSchema. Preserve these consumers initially. The new hook declares
the same conversion behavior in an easier-to-find place; it does not add a second
HTML serializer beside the schema.

Collect HTML rule declarations during options-only extension resolution. Before
constructing the schema, attach the resolved serialize/parse rules to their
owning node/mark specs. Build the schema once. Callbacks receive their normal
runtime node, mark, or DOM inputs; registration cannot require the not-yet-built
schema. A reference to an unknown node/mark is a configuration error.

During migration, schema-embedded rules are normalized as legacy contributions.
Reject one extension declaring both old `toDOM` and new serialize behavior for
the same type, or both old `parseDOM` and new parse behavior. Different directions
can migrate independently. Across extensions, preserve the established override
and warning policy while tracking the rule's contributor separately from the
schema type owner. DOM parse-rule arrays retain their order and priority.

Keep HTML rule types faithful to ProseMirror: node/mark DOM output specifications
and parse-rule lists, including content holes and attribute parsing. Do not
replace them with concatenated HTML strings. Output callbacks requiring a DOM
must run only with a supplied DOM environment; headless support is not created
automatically by moving their registration.

Clipboard packaging remains outside per-node rules. In particular:

- Preserve selection/slice semantics and `data-pm-slice` open depths.
- Preserve cell-selection table wrapping and vertical-merge conversion through
  collapseRowSpans/expandRowSpans. Record current limitations rather than claiming
  an exact round trip for every selection shape.
- Keep URL safety, foreign-HTML cleanup, and normalization on all ingestion paths.
  A new HTML parser entry point must not bypass those gates.
- Clipboard HTML and publishable document HTML may use different envelope
  policies. Shared node rules do not force clipboard-only metadata into exports.

### Table HTML exposes a second level of serialization

The current table HTML serializer already exists. Its NodeSpec `toDOM` emits
`table`, `colgroup`, `tbody`, `tr`, `td`, and `th` structure, with content holes
filled by ProseMirror's serializer. It reads document attributes, not measured
cell rectangles. `domAttrs.ts` owns mappings such as `gridSpan → colspan`,
alignment, fill, and grid column widths.

There is also a WHOLE-TABLE conversion that individual cell rules cannot do:
Scrivr stores one cell per row with `vMerge: restart/continue`; ordinary HTML
stores one cell with `rowspan` and omits its covered cells. Today the Table
extension registers expandRowSpans through addPasteHtmlTransforms, while
ClipboardSerializer directly calls collapseRowSpans after DOM serialization.
Moving only `toDOM` and `parseDOM` would leave this table-specific serialization
behavior outside the new ownership model.

Therefore HTML bundles also declare ordered structural transforms:

```text
Serialize: source slice → schema DOMSerializer → finalizeDOM → HTML envelope
Parse: safe input DOM → prepareDOM → schema DOMParser → document normalization
```

For Table, finalizeDOM runs collapseRowSpans and prepareDOM runs expandRowSpans.
These are format transformations, not painting and not general paste policy.
They run on a detached operation-local root, never mutate the editor's live DOM,
and operate once per conversion, preserving nested-table and row-group ownership.
The parser/serializer engine invokes registered transforms in deterministic
extension order and preserves each contribution's array order. Test interactions
between transforms; moving them is not permission to reorder ingestion safety
or existing cleanup stages.

Keep all legacy call sites until the canonical HTML engine reaches EVERY current
clipboard/paste consumer. Then remove the direct clipboard collapse call and
the old table paste-hook registration in the same migration, so transforms
neither disappear nor run twice. General paste hooks remain separate; do not
blindly move arbitrary input transforms into format parsing.

This is the distinction the API must express:

| Table path | Decision |
|---|---|
| Canvas / PDF | Which lines and fills paint the measured row rectangles? |
| HTML | Which tags, attributes, and row-span structure represent the table? |
| Markdown | How can a table be expressed as pipe-delimited text, accepting lost structure? |
| DOCX | Which grid, cells, and merge properties represent the table in OOXML? |
| Semantic | Which structured cells, spans, and merge attributes describe its meaning? |

The current Markdown serializer flattens cell text and promotes the first row
to a Markdown header. The semantic table handler suppresses that Markdown form
when merges exist and retains structured cell data. Consolidation preserves
these distinct fidelity policies; it does not route every format through HTML.

### Format engines remain format-specific

Markdown `serialize` wraps the existing node/mark serializer rules; `parse`
wraps token handlers. The Markdown engine owns tokenization, enabled syntax,
escaping, and the document walk. Paste's decision to treat text as Markdown is
input policy and remains outside this registration.

DOCX retains separate document-tree serialization and package/XML import
contracts. Pair them in the declaration while keeping zip/media/relationships,
styles, document attributes, diagnostics, and async lifecycle in their existing
format engine. Do not reduce the current multi-stage DOCX import surface to
`parse(string): Node`. A format's tree and file-level hooks must be preserved.

Semantic serialization retains its current result types and unsupported-content
policy. A `parse` direction should be added only with an explicit supported
input contract; do not infer reversibility from the presence of `serialize`.

## 4. Shared painting, separate backends

Canvas and PDF still have their own handlers. A common helper owns visual
rules when those rules are equivalent:

```text
canvas.nodes.tableRow ──┐
                       ├─ shared table-grid painting helper
pdf.nodes.tableRow ─────┘              ↓
                              supplied drawing surface
                              ├─ Canvas implementation
                              └─ PDF implementation
```

For example, `paintTableGrid(block, surface)` reads resolved cell geometry and
owns border visibility. The surface implements neutral line/rectangle calls.
The canvas adapter translates these to canvas operations; the PDF adapter
translates them to PDF-library calls.

The helper receives layout geometry, not raw document content. It does not
measure text, choose page breaks, embed assets, or import a rendering backend.
Handlers remain responsible for dispatching child blocks through their target's
context. Canvas retains character-map registration; PDF retains export asset
handling. Neither target should bypass the registered child handler merely
because a shared helper exists.

Start with the smallest useful drawing contract: lines, rectangles, colors,
opacity, and explicit stroke widths in layout pixels. Coordinates use a declared
top-left origin; the backend owns device scaling or PDF unit/axis conversion.
Use plain colors/resource identities, never CanvasRenderingContext2D or PDFFont
objects, in backend-neutral operations.

No retained display list is required. The surface can execute calls immediately;
a recording surface can collect operations for tests. Recording, caching, and
replaying complete pages are separate future work.

Preserve draw ordering deliberately. Current canvas tables fill cell backgrounds
before drawing the grid; PDF tables interleave per-cell fill, stroke, and child
dispatch. Extracting a helper must characterize overlap behavior and either
preserve each output or explicitly review an intended ordering correction.
Do not silently change fidelity inside a hook rename.

Text sharing comes later. A text drawing contract needs resolved font identity,
baseline, measured advances, justification, and supported positioning behavior.
A `{ text, fontFamily, x, y }` operation does not establish cross-backend fidelity.

## 5. Measurement and backend dependencies

Renderer registration does not choose the layout's measurement backend.
Core defines TextMeasurerLike; the layout caller supplies an implementation.
The PDF package may supply PDF-font measurements for a fresh export layout.
It must not globally replace the live editor's measurer.

Retain the current font-aware export distinction:

```text
Compatible font resources:
  screen DocumentLayout → visual handlers → canvas or PDF

Different export font resources:
  captured document → export measurement → export DocumentLayout → PDF handlers
```

In the second path the painting implementation can be shared, but the resulting
geometry and operations can differ. Never silently replace a font during paint
and assume measurements from another face are still valid.

Core owns contracts, extension registration, and backend-neutral layout/output
types. The PDF package owns font embedding, pdf-lib objects, coordinate
conversion, resource preparation, and serialization. DOCX packaging remains in
the DOCX backend. Type-only registration must not pull optional backend runtime
dependencies into core or canvas applications.

### Existing PDF context gap

Node painting already has a core-defined PdfNodeContext and drawing primitives.
However, the current PdfHandlers bundle, PdfChromeHandler, and export lifecycle
hooks are declared in the PDF package; chrome/hooks still receive the full
PdfContext with backend objects. Treat this as migration work, not as an already
neutral contract.

Define core-visible contracts for standard chrome painting and export lifecycle
capabilities before moving their registration types. Inventory actual context
usage first. Separate document-level output configuration from per-block paint.
If a consumer requires raw pdf-lib access, preserve it temporarily through an
explicit backend-owned legacy adapter and decide a documented backend extension
API. Do not copy PdfContext into core, silently narrow it with casts, or remove
capabilities without a compatibility decision.

## 6. Typed renderer and serialization registries

Proposed shape; the named bundle types below include newly extracted contracts:

```ts
interface RendererTargets {
  canvas: CanvasRendererHandlers;
  pdf: PdfRendererHandlers;
}

type RendererContributionMap = {
  [Target in keyof RendererTargets]?: RendererTargets[Target];
};

interface SerializationFormats {
  html: {
    serialize?: HtmlSerializerRules;
    parse?: HtmlParserRules;
  };
  markdown: {
    serialize?: MarkdownSerializerRules;
    parse?: MarkdownParserRules;
  };
  docx: {
    serialize?: DocxSerializationHandlers;
    parse?: DocxParsingHandlers;
  };
  semantic: {
    serialize?: SemanticHandlers;
  };
}

type SerializationContributionMap = {
  [Format in keyof SerializationFormats]?: SerializationFormats[Format];
};
```

The built-in keys must be declared in the contract layer visible while compiling
core and plugins. They cannot depend on importing an optional runtime package
to activate augmentation. Third-party packages can augment RendererTargets or
SerializationFormats with their own contract types. Built-in names have one
home: for example DOCX is not simultaneously registered in both maps.

This addresses a current gap: an empty FormatHandlers interface yields `{}`,
which does not reject arbitrary properties as the existing comments suggest.
Explicitly type the known slots and test registration itself, not just separately
typed handler bodies. Inline hook returns should use a checked contribution
object, such as `satisfies RendererContributionMap` or
`satisfies SerializationContributionMap`, where excess-property checks
are needed. TypeScript structural typing is not an exact-object guarantee for
arbitrary preconstructed values.

Type fixtures must prove that wrong PDF handler values, canvas handlers in DOCX
slots, a semantic parse slot that has no contract, and misspelled literal keys
fail in core, plugins, and an external consumer without importing optional
runtime backends.

## 7. Resolution, dispatch, and collision rules

Resolve addRenderers and addSerialization in the extension's existing options-
only registration phase. Normalize contributions into canonical renderer and
serialization maps with extension provenance. Consumers read those maps, even
while old accessors exist as compatibility views. HTML rules must be available
to the schema-build phase, not attached after schema creation.

The manager can expose a typed target query such as
`getRendererContributions("pdf")` and `getSerializationContributions("docx")`.
Existing canvas registries can be built from `canvas.nodes` / `inline` / `marks`;
format engines select their serialize or parse direction and keep their current
traversal. Unified registration does not require one universal walker.

Preserve target-specific dispatch keys during migration. Canvas currently uses
`block.blockType`, whereas PDF node dispatch uses `block.node.type.name`.
Renaming those keys or making them identical is separate behavior-changing
work; list and custom strategies must not disappear during normalization.

Collision rules:

- Within an extension, old and new hooks claiming the SAME normalized slot
  are an error naming the extension, target/format, direction, and key. Do not choose silently,
  even if the function references happen to match.
- Disjoint old/new slots may coexist while an extension migrates.
- Across extensions, preserve the target's existing documented ordering and
  override behavior. For canvas/PDF node maps, later registration currently
  wins. An intentional downstream override must keep working.
- Preserve ordered lifecycle hooks rather than collapsing them into a map.
  Duplicate legacy/new lifecycle declarations for one extension require an
  explicit migration; never run the same hook twice.
- Measurement-contributor uniqueness remains its own validation. Output
  registration must not weaken layout ownership checks.

Use own-property-safe collection and preserve backend missing-handler policies.
Do not invent a universal silent fallback. Registration and consumption require
tests for nested content, chrome, inline objects, and marks as well as body nodes.

## 8. Migration phases

| Phase | Change | Required evidence |
|---|---|---|
| 0 — Contract inventory | Map hooks, target contexts, dispatch keys, schema timing, consumers, override rules, and backend dependencies | Recorded compatibility decisions, especially HTML compilation, PDF chrome/lifecycle, and mixed inline measurement/paint |
| 1 — Typed registries | Add addRenderers and addSerialization, built-in contracts, canonical normalization, and legacy adapters | Compile-time registration tests; duplicate-slot errors; optional backends remain optional |
| 2 — Existing routing | Read canvas registries, format engines, and schema HTML rules from canonical contributions | Old and new declarations produce equivalent output and parsed content; nested dispatch and overrides preserved |
| 3 — Built-in migration | Migrate block/mark/inline/chrome painting and HTML/Markdown/DOCX/semantic conversion; split measurement where necessary | First-party extensions use the two hooks; measurement works headlessly; hooks execute once; clipboard behavior preserved |
| 4 — Shared table painting | Extract neutral grid/background helpers used by both visual handlers | Operation-level and visual tests pin edges, colors, ordering, and child dispatch |
| 5 — Deprecation | Document migration and deprecate old hooks/accessors | Consumer migration examples and release-policy-compliant removal schedule |

Keep registry migration behavior-preserving. Shared-helper extraction is a
separate reviewable change. No changes to pagination or resumable paragraph
algorithms are required to prove this API. Conversely, resumable layout should
produce fragments independently of which renderer targets are registered.

Do not advertise completion after migrating only addExports and block painters:
the declared end state also includes mark/inline/chrome painting and the paired
HTML, Markdown, and DOCX conversion declarations.
Intermediate releases must state which legacy adapters remain.

## 9. Verification

- Compile an invalid registered handler in each built-in target and verify a
  type error in the package that owns the extension.
- Use a synthetic extension whose output is observable through each target's
  real registration → collection → dispatch path.
- Exercise canvas/PDF body blocks, nested table children, inline atoms, marks,
  and page chrome. Verify overriding a handler reaches every relevant path.
- Verify async export lifecycle ordering, single execution, and error propagation.
- Compare legacy and new declarations; reject duplicate same-extension slots;
  preserve intentional inter-extension overrides and prototype-named keys.
- Verify DOCX/semantic serialization receives the source tree, independent of
  page count or fragmentation. Preserve Markdown serialization and parsing.
- Compare legacy schema HTML rules with newly compiled rules for nodes and
  marks; preserve DOM output holes, rule order/priority, attributes, and escaping.
- Exercise partial text selection, cell selection, merged tables, and
  foreign-HTML paste through the actual clipboard path. Preserve slice metadata,
  safety checks, and post-parse normalization; record lossy cases explicitly.
- Run whole-table HTML transforms exactly once through both migrated and legacy
  entry points. Verify row groups, nested tables, and copied ranges beginning
  inside a vertical merge; avoid duplicate expansion or collapse.
- Verify HTML contribution collection happens before schema construction and
  does not need an editor, canvas, or PDF instance. Backend DOM requirements
  belong to execution, not registration.
- Verify inline measurement and header/footer measurement still work without a
  canvas painter or PDF runtime installed.
- Verify shared table painting handles vertical merges, last-row borders,
  backgrounds, and child rendering with intentional draw order. Canvas character
  mapping and PDF text/link behavior remain backend responsibilities.
- Retain existing PDF operation-log and font-resolution tests. A registry rename
  is not permission to retypeset or silently substitute fonts.
- Check package dependency direction: no PDF/DOCX backend runtime import from
  core contracts or built-in canvas registration.

## 10. Code entry points and relation to existing RFCs

- [Extension resolution](../packages/core/src/extensions/Extension.ts): currently
  resolves exports, layout handlers, inline handlers, decorators, and Markdown
  serializers separately.
- [ExtensionManager](../packages/core/src/extensions/ExtensionManager.ts):
  contribution collection and canvas registry construction.
- [Extension types](../packages/core/src/extensions/types.ts) and
  [export maps](../packages/core/src/extensions/export.ts): hook and target typing.
- [ClipboardSerializer](../packages/core/src/input/ClipboardSerializer.ts) and
  [PasteTransformer](../packages/core/src/input/PasteTransformer.ts): existing
  schema-driven HTML conversion and clipboard envelope/ingestion policy.
- [Table DOM attributes](../packages/core/src/table/domAttrs.ts) and
  [table HTML transforms](../packages/core/src/table/clipboardHtml.ts): per-node
  representation versus whole-table rowspan conversion.
- [Paragraph extension](../packages/core/src/extensions/built-in/Paragraph.ts):
  concrete example of HTML rules, Markdown directions, and DOCX directions
  currently spread across schema specs and separate hooks.
- [Table extension](../packages/core/src/extensions/built-in/Table.ts): first
  concrete migration example.
- [Canvas table strategy](../packages/core/src/renderer/TableRowStrategy.ts) and
  [PDF table handler](../packages/core/src/table/pdfExport.ts): shared-paint pilot.
- [Page chrome contracts](../packages/core/src/layout/PageMetrics.ts): split
  measurement ownership from canvas painting registration.
- [Core PDF surface](../packages/core/src/exports/pdf.ts) and
  [PDF target augmentation](../packages/export-pdf/src/augmentation.ts): existing
  neutral node primitives and remaining backend-context migration work.

This proposal revises the initial all-targets-in-addRenderers draft into two
clear responsibilities: visual rendering and document serialization/parsing.
It preserves target-specific signatures, optional backend packages, and the
format-ownership rule that extensions own their content's behavior. It does not
require the full shared display list deferred by that RFC or a replacement for
ProseMirror's HTML and Markdown machinery.

## 11. What shipped

Nothing yet — this is a proposal. Updated as each phase lands, so design and
reality stay in one document. Where the code and the sections above disagree,
this section says so rather than the proposal being quietly rewritten to match.

The pieces the migration phases build on are already in place and named in
section 10: the core PDF drawing surface, extension-owned mark and node
handlers, and the shared-paint table pilot. Those landed under the
[format ownership RFC](./format-lane-ownership-rfc.md) and are recorded there,
not here.
