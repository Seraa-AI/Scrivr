# DOCX Export Plan

> Status: **design only** — no implementation yet.  
> Trigger: when a concrete DOCX export feature is requested, or M2 export dispatch refactor lands.

## Core principle

**PDF = paint what you saw. DOCX = rebuild what you meant.**

DOCX is tree-driven, not layout-driven. Handlers walk the ProseMirror node tree and produce XML elements. `LayoutPage`, `x`, `y`, `width` are irrelevant — Word decides pagination and rendering. Never lean on layout data in DOCX handlers, even when it's available.

## What the current architecture already solves

- **`addExports()` lane** — DOCX is `{ docx: { ... } }` in the contribution map. No core changes.
- **Format-specific handler types** — `DocxNodeHandler` has a completely different signature from PDF. `FormatHandlers` augmentation supports this.
- **Default handlers + extension overrides** — core schema → default DOCX serializers, plugins → their own nodes.
- **Lifecycle hooks (`onBeforeExport`)** — critical for precomputing numbering, references, TOC, styles, bookmarks.
- **`requiresLayout: false`** — DOCX skips `ensureLayout({ force: true })` entirely.

## Where DOCX diverges from PDF

### Styles are named references

```xml
<w:pStyle w:val="Heading1"/>
```

PDF applies font/color inline. DOCX registers styles and emits references.

```ts
ctx.styles.register("heading1", { font: "Calibri", size: 28, bold: true });
// Handler returns a style reference, not raw formatting
```

### Images are relationship-based

PDF embeds bytes and draws. DOCX adds to `/word/media`, creates an OPC relationship, references via `<w:drawing>`.

```ts
const relId = ctx.rels.addImage(imageBytes, "image/png");
// Handler emits <w:drawing> referencing relId
```

### Page numbers are dynamic fields

PDF knows `layout.pages.length`. DOCX emits field instructions that Word evaluates.

```xml
<w:fldSimple w:instr="NUMPAGES"/>
```

Plugins contributing page-number tokens must think in fields, not computed values.

### Block vs inline is structural

- Block nodes → `<w:p>` (paragraphs)
- Inline nodes → `<w:r>` (runs)

Same `image` handler key, but output differs structurally:
- Inline image → `<w:r>` with `<w:drawing>` inside
- Block image → standalone `<w:p>` with drawing

Handlers may need `isInlineContext(ctx)` branching.

### Handler return types

| Format | Return type | Model |
|--------|-------------|-------|
| PDF | `void` | Imperative rendering (side-effect drawing) |
| Markdown | `string` | String composition |
| DOCX | `XmlNode \| XmlNode[]` | Tree construction → finalization |

DOCX export is `buildTree() → finalize()`, not a streaming draw loop.

## Handler signature

Context sensitivity (inline vs block) must be explicit in the handler, not inferred from `ctx.currentParagraph`. This keeps the single-dispatch-table rule intact while solving DOCX's structural needs:

```ts
type DocxNodeHandler = (
  node: Node,
  ctx: DocxContext,
  meta: { inline: boolean },
) => XmlNode | XmlNode[];
```

The `image` handler uses `meta.inline` to decide:
- `inline: true` → emit `<w:r>` with `<w:drawing>` inside
- `inline: false` → emit standalone `<w:p>` with drawing

No guessing, no fragile `isInlineContext()` checks.

## Lifecycle phases

```
onBeforeExport(ctx)     → precompute TOC, numbering, cross-refs, bookmarks
walkTree(doc, handlers) → handlers produce XmlNode trees (pure, no global cursor)
onBuildTreeComplete(ctx)→ post-walk fixups: inject bookmarks, resolve internal links
onAfterExport(ctx)      → plugin cleanup
assemblePackage(ctx)    → write /word/document.xml, styles.xml, numbering.xml, rels, [Content_Types].xml
```

`onBuildTreeComplete` is distinct from `onAfterExport` — it runs after the full tree exists but before OPC packaging. Features like cross-references and bookmark injection need the complete tree but can't wait until after the package is assembled.

## DocxContext shape (design reference)

```ts
interface DocxContext {
  // Style management — split by Word style type to prevent mixing
  // paragraph + character + table styles (produces invalid OOXML).
  // getOrCreate deduplicates by name; plugins use semantic names
  // ("heading1", "codeBlock") not plugin-specific names.
  styles: {
    paragraph: { getOrCreate(name: string, spec: DocxParagraphStyleSpec): string };
    character: { getOrCreate(name: string, spec: DocxCharacterStyleSpec): string };
    table:     { getOrCreate(name: string, spec: DocxTableStyleSpec): string };
  };

  // Numbering — declarative API hides Word's abstractNum/numId internals.
  // Plugins describe what they want; the engine maps to Word primitives.
  // Deterministic + reusable: mixed list types across plugins share
  // abstractNum definitions when their level specs match.
  numbering: {
    getOrCreate(spec: {
      type: "bullet" | "ordered" | "task";
      levels: DocxNumberingLevel[];
    }): { numId: number };
  };

  // OPC relationships — images, hyperlinks, external refs
  rels: {
    addImage(bytes: Uint8Array, mime: string): string; // returns rId
    addHyperlink(url: string): string;
  };

  // Document tree — the root XmlBuilder. Handlers return XmlNode trees;
  // the walker composes them. No mutable cursor (currentParagraph removed
  // — handlers are pure tree producers, walker handles composition).
  document: XmlBuilder;

  // Shared derived data across plugins. Collaborative, not overwrite:
  // getOrInit returns existing value or initializes with the factory.
  // Populated in onBeforeExport, read in handlers. Prevents duplicate
  // doc walks + inconsistent derived data across plugins.
  //
  // Conventions:
  //   "headings"  → HeadingEntry[]
  //   "footnotes" → FootnoteMap
  //   "citations" → CitationMap
  shared: {
    getOrInit<T>(key: string, init: () => T): T;
    get<T>(key: string): T | undefined;
  };
}
```

**Design rules:**
- Handlers are **pure tree producers**: `(node, ctx, meta) → XmlNode[]`. No mutating a global cursor.
- The tree walker composes child results into parent nodes. Plugins never need to track "current paragraph."
- `ctx.shared` uses `getOrInit` (append/collaborate) not `set` (overwrite) to prevent last-writer-wins bugs between plugins.

## Risks to watch

### Stateful preprocessing (`onBeforeExport` will get crowded)

`onBeforeExport` runs before any handlers. DOCX needs TOC, numbering, cross-references, bookmarks — all precomputed. Two plugins walking the same heading tree creates duplication + ordering dependency. `ctx.shared` is the coordination mechanism — promote it to a first-class documented pattern with named conventions (`"headings"`, `"footnotes"`, `"citations"`), not an afterthought.

### Format drift is expected (don't fight it)

A `CalloutBox` renders as:
- PDF: colored rectangle + text
- Markdown: `> [!INFO]`  
- DOCX: styled table, or content control, or indented paragraph

Don't force visual parity across formats. Each format expresses intent in its own idiom. Plugins will naturally diverge — that's by design.

### Style inflation across plugins

If every plugin calls `styles.register("my-random-style", {...})` with ad-hoc names, documents bloat with duplicate/inconsistent styles. Mitigated by `getOrCreate` semantics — same name + same spec deduplicates. Establish naming conventions early (e.g. `"heading1"`, `"codeBlock"`, not plugin-specific names).

### Numbering edge cases

Word numbering is deceptively complex: `abstractNum` (definition) vs `numId` (instance), multi-level, cross-plugin. Nested lists from different plugins (task list + bullet list) must share `abstractNum` definitions correctly. Numbering must be deterministic and reusable.

### Inline atom context sensitivity

Resolved by explicit `meta: { inline: boolean }` in the handler signature (see Handler signature section). No runtime guessing.

## Litmus test

Before building, verify this scenario works end-to-end with the current architecture:

> A plugin defines:
> - A block node (e.g. CalloutBox)
> - An inline atom node (e.g. MentionChip)
> - A mark (e.g. CitationRef)
>
> All three render on canvas, paginate, and export correctly to PDF, Markdown, AND DOCX — without touching core or other plugins.

If that passes, the system is complete. If any of the three categories fails, the gap surfaces during DOCX.

## Pre-implementation step

Define `DocxHandlers` + `DocxContext` as a **type-only PR** (no XML generation, no runtime code). Stress-test whether `addExports()` is truly sufficient before writing the engine. The type definitions will reveal any hidden assumptions leaking from PDF.

## Dependencies

- M2 export dispatch refactor (real handler shapes for PDF/Markdown)
- Track changes support via `<w:ins>` / `<w:del>` revision marks (aligns with the existing TrackChanges extension)

## XML / OPC library choice

DOCX is a ZIP archive of XML files (OPC format). We need two capabilities: building XML nodes and assembling the ZIP package.

### Option A: `docx` (npm `docx`)

High-level, declarative API. Handlers return `docx.Paragraph`, `docx.TextRun`, etc. — the library handles XML serialization + OPC packaging.

```ts
import { Paragraph, TextRun, Document, Packer } from "docx";

// Handler returns library objects
const handler: DocxNodeHandler = (node, ctx, meta) =>
  new Paragraph({ children: [new TextRun(node.textContent)] });

// Package assembly is one call
const buffer = await Packer.toBuffer(doc);
```

**Pros:** battle-tested, handles styles/numbering/relationships/content-types automatically, large community, good TypeScript types, abstracts away OOXML complexity (namespace prefixes, required elements, relationship IDs).

**Cons:** large bundle (~200KB min), opinionated API surface (our handlers return library objects rather than raw XML — tighter coupling to the library), may constrain advanced scenarios where we need raw XML control (track changes revision marks, custom XML parts).

### Option B: `pizzip` + raw XML templates

Low-level: we build XML strings (or a lightweight builder), assemble the ZIP ourselves.

```ts
import PizZip from "pizzip";

const xml = `<w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p>`;
zip.file("word/document.xml", wrapDocument(bodyXml));
```

**Pros:** tiny bundle, full control over every byte of XML, no abstraction leakage, easy to emit track-changes revision marks exactly as needed.

**Cons:** we own all OOXML correctness (namespaces, required elements, relationship bookkeeping), more code to maintain, easy to produce invalid documents.

### Option C: Hybrid — `docx` for structure, raw XML for edge cases

Use `docx` library for the 90% case (paragraphs, runs, tables, images, styles, numbering). For advanced features that need raw XML control (track changes `<w:ins>`/`<w:del>`, custom XML parts, field codes), use the library's `RawXml` escape hatch or supplement with direct XML injection.

```ts
import { Paragraph, TextRun, ExternalHyperlink } from "docx";

// Normal handler — library objects
const paragraphHandler = (node, ctx, meta) =>
  new Paragraph({ style: "Normal", children: walkInlineChildren(node, ctx) });

// Track changes — raw XML where the library doesn't cover it
const trackedInsertHandler = (node, ctx, meta) =>
  new Paragraph({
    children: [new InsertedTextRun({ text: node.textContent, id: ctx.revisionId(), author: node.attrs.author, date: node.attrs.date })]
  });
```

### Recommendation: Option A (`docx` library) with raw XML escape hatch

**Why:**
- The `docx` library handles the hardest parts automatically: style XML generation from specs, numbering `abstractNum`/`numId` management, relationship IDs for images/hyperlinks, `[Content_Types].xml`, OPC ZIP assembly. These map directly to our `DocxContext` design (`ctx.styles`, `ctx.numbering`, `ctx.rels`).
- Our handler signature `(node, ctx, meta) → XmlNode` maps cleanly to returning `docx` library objects (`Paragraph`, `TextRun`, `Table`, `ImageRun`).
- Track changes: the `docx` library supports `InsertedTextRun` and `DeletedTextRun` natively — aligns with our existing `trackedInsert`/`trackedDelete` marks.
- Bundle size (~200KB) is acceptable for an export-only package that isn't loaded on every page view — it's lazy-imported when the user clicks "Export to DOCX."

**What changes in DocxContext:**
- `XmlBuilder` in the context shape becomes `docx.Document` (or a wrapper around it)
- `XmlNode` return type from handlers becomes `docx.Paragraph | docx.Table | docx.TextRun | ...`
- `ctx.styles` maps to `docx` style definitions passed to `new Document({ styles: ... })`
- `ctx.numbering` maps to `docx` numbering config
- `ctx.rels` is handled implicitly by the library (images are added via `ImageRun`, hyperlinks via `ExternalHyperlink`)
- Package assembly: `Packer.toBuffer(doc)` or `Packer.toBlob(doc)` — no manual ZIP

**When to finalize:** during the type-only PR that defines `DocxHandlers`. Import the `docx` library's types to verify our handler signatures align before writing any runtime code.
