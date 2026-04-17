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

## DocxContext shape (design reference)

```ts
interface DocxContext {
  // Style management — register named styles, emit references
  styles: {
    register(name: string, spec: DocxStyleSpec): void;
    resolve(name: string): string; // returns style ID
  };

  // Numbering — Word's multi-level list system
  numbering: {
    register(abstractId: number, levels: DocxNumberingLevel[]): void;
    instance(abstractId: number): number; // returns numId
  };

  // OPC relationships — images, hyperlinks, external refs
  rels: {
    addImage(bytes: Uint8Array, mime: string): string; // returns rId
    addHyperlink(url: string): string;
  };

  // Document tree builder
  document: XmlBuilder;
  currentParagraph: XmlBuilder | null;

  // Shared state across plugins (derived data like heading structure)
  shared: Map<string, unknown>;
}
```

## Risks to watch

### Stateful preprocessing

`onBeforeExport` runs before any handlers. DOCX needs TOC, numbering, cross-references, bookmarks — all precomputed. Two plugins walking the same heading tree creates duplication + ordering dependency. When 2+ plugins need the same derived data, introduce `ctx.shared` for coordination.

### Format drift is expected

A `CalloutBox` renders as:
- PDF: colored rectangle + text
- Markdown: `> [!INFO]`  
- DOCX: styled table, or content control, or indented paragraph

Don't force visual parity across formats. Each format expresses intent in its own idiom.

### Inline atom context sensitivity

Unique to DOCX among current formats. PDF's unified dispatch works because everything is "draw at coords." DOCX needs structural awareness: same node type, different output depending on whether it's inline or block context.

## Litmus test

Before building, verify this scenario works end-to-end with the current architecture:

> A plugin defines a custom node that:
> - Renders visually on canvas
> - Paginates correctly
> - Exports to PDF, Markdown, AND DOCX
> - Without touching core or other plugins

If that's clean, the system is complete. If not, the gap surfaces during DOCX.

## Pre-implementation step

Define `DocxHandlers` + `DocxContext` as a **type-only PR** (no XML generation, no runtime code). Stress-test whether `addExports()` is truly sufficient before writing the engine. The type definitions will reveal any hidden assumptions leaking from PDF.

## Dependencies

- M2 export dispatch refactor (real handler shapes for PDF/Markdown)
- A concrete XML builder library choice (e.g. raw string templates, `xmlbuilder2`, or custom)
- Track changes support via `<w:ins>` / `<w:del>` revision marks (aligns with the existing TrackChanges extension)
