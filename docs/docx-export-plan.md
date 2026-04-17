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

## DocxContext shape (design reference)

```ts
interface DocxContext {
  // Style management — namespaced to prevent duplicate inflation.
  // getOrCreate deduplicates; plugins don't freestyle random style names.
  styles: {
    getOrCreate(name: string, spec: DocxStyleSpec): string; // returns style ID
    resolve(name: string): string;
  };

  // Numbering — Word's multi-level list system.
  // Must be deterministic + reusable: nested lists across plugins or
  // mixed node types (task list + bullet list) share abstractNums.
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

  // Shared derived data across plugins. First-class pattern, not ad-hoc.
  // Conventions: "headings" → HeadingEntry[], "footnotes" → FootnoteMap,
  // "citations" → CitationMap. Populated in onBeforeExport, read in handlers.
  // Prevents duplicate doc walks + inconsistent derived data.
  shared: Map<string, unknown>;
}
```

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
- A concrete XML builder library choice (e.g. raw string templates, `xmlbuilder2`, or custom)
- Track changes support via `<w:ins>` / `<w:del>` revision marks (aligns with the existing TrackChanges extension)
