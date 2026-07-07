# @scrivr/export-semantic

Semantic chunk export for Scrivr documents — turn a document into an ordered list of **AI-ready `SemanticUnit`s** for RAG / embedding pipelines.

Instead of flattening a document downstream and re-guessing where the chunks are, Scrivr emits the structure and identity it already knows: each unit carries its type, a stable id, the heading path it lives under, explicit text view, plain text for embedding, and optional structure-preserving markdown. Like `@scrivr/docx`, it is extension-aware — every node and mark contributes its own semantic handler, so custom extensions (a callout, a footnote, a comment mark) plug into the same seam with no changes to the walker.

It runs **headless**: given a `ServerEditor` and a document's `contentJSON`, it produces units with no canvas, layout, or DOM.

## Installation

```bash
pnpm add @scrivr/core @scrivr/export-semantic
```

## What is a SemanticUnit?

A `SemanticUnit` is one retrievable chunk of a document — a paragraph, a whole list, a table, a heading and its lede, etc. — carrying the context an embedding pipeline needs:

```ts
interface SemanticUnit {
  id: string;              // stable anchor id = nodeIds[0]
  nodeIds: string[];       // every block this unit owns, in document order
  type: "heading" | "paragraph" | "table" | "list"
      | "codeBlock" | "image" | "horizontalRule" | "pageBreak" | "unknown";
  role: "body" | "header" | "footer";
  view: "proposed";        // pending inserts included; pending deletes excluded into changes
  breadcrumb: string[];    // heading path, e.g. ["Master Agreement", "Indemnification"]
  headingLevel?: number;
  order: number;           // monotonic document order
  text: string;            // plain text for embedding
  attrs?: Record<string, unknown>; // block styling markdown can't express (align, indent, font…)
  spans?: InlineSpan[];    // inline formatting runs — bold/italic/color/highlight/link, with attrs
  markdown?: string;       // convenience projection only; omitted when changes are present
  cells?: TableCells;      // structured rows/cells with gridSpan/vMerge (spanned tables)
  changes?: SemanticChange[]; // review metadata (e.g. suggested deletions), excluded from text
}
```

The editor owns **semantics + identity**. The consumer owns **sizing + embedding policy** — target chunk size is embedding-model-specific and stays in your pipeline, not the editor. Embed whatever you like from a unit; the recommended input is `breadcrumb.join(" › ") + "\n" + text`.

`view: "proposed"` is the v1 text contract: suggested insertions are included in `text`, suggested deletions are excluded from `text` and preserved as `changes`. The same view applies to `spans` and `cells[].text`.

### What the walker does for you

- **Cohesive-pair grouping** — a heading followed by a single short lede paragraph becomes *one* unit, so a heading never becomes a tiny chunk that out-ranks the clause it heads. A whole list is one unit; everything else is one unit per block.
- **Breadcrumbs** — every unit carries its ancestor heading path, reconstructed from a heading stack (siblings and top-level headings correctly reset).
- **Stable identity** — `id` is the block's `nodeId`. When ids are absent it falls back to a deterministic positional path (`"p:0"`, `"p:1"`, …) that is stable for a given tree shape. Emission is deterministic: the same document always produces the same units — the contract downstream change-detection relies on.
- **Mark-aware text** — plain text (and breadcrumbs, and table-cell text) is produced through the mark seam, so e.g. suggested-deletion text is kept out of embeddings while being preserved as structured `changes`.

## Usage in the editor

Add the `SemanticExport` extension to wire up a toolbar button and editor command, just like `DocxExport` / `PdfExport`:

```ts
import { Editor, StarterKit } from '@scrivr/core';
import { SemanticExport } from '@scrivr/export-semantic';

new Editor({
  extensions: [
    StarterKit,
    SemanticExport.configure({ filename: 'my-doc-chunks' }),
  ],
});
```

This adds a "⬇ Chunks" toolbar button and `editor.commands.exportSemantic()`.

Semantic units are **data**, not a file blob, so the command has two modes:

```ts
// Browser: download the units as a .json file
editor.commands.exportSemantic();
editor.commands.exportSemantic({ filename: 'contract-chunks' });

// Anywhere (incl. headless): receive the units directly
editor.commands.exportSemantic({
  onExport: (units) => {
    for (const u of units) embed(u.breadcrumb.join(' › ') + '\n' + u.text);
  },
});
```

## Usage on the server

The bare `toSemanticUnits` function needs no view or layout. Pair it with `ServerEditor`:

```ts
import { ServerEditor, StarterKit } from '@scrivr/core';
import { toSemanticUnits } from '@scrivr/export-semantic';

const editor = new ServerEditor({
  extensions: [StarterKit],
  content: contentJSONFromDb, // ProseMirror JSON
});

const units = toSemanticUnits(editor);

for (const unit of units) {
  const input = unit.breadcrumb.length
    ? unit.breadcrumb.join(' › ') + '\n' + unit.text
    : unit.text;
  await index({ id: unit.id, order: unit.order, embedding: await embed(input), unit });
}
```

`ServerEditor` never fabricates ids on load — it preserves the `nodeId`s already persisted in `contentJSON` and leaves the rest to the positional fallback. So loading the same document twice yields the same units.

### Options

```ts
toSemanticUnits(editor, {
  shortBlockMaxChars: 200,   // max chars a heading's "lede" may have to group (default 200)
  overrides: { /* SemanticHandlers */ }, // handlers that win over extension-contributed ones
});
```

## Extending it

Every unit's `type`, `text`, `markdown`, `cells`, and `changes` come from handlers contributed by extensions through `addExports().semantic`. Built-in nodes (paragraph, heading, list, table, code block, …) already register theirs. To support a **custom node or mark**, contribute a handler from its extension — no walker changes.

### A custom node handler

A node handler classifies one node and, when the markdown serializer can't express its structure, supplies extras. `text`/`markdown` are optional overrides; omit them and the walker fills them from the shared serializer.

```ts
import { Extension } from '@scrivr/core';
import type { SemanticNodeHandler } from '@scrivr/core';

const Callout = Extension.create({
  name: 'callout',
  addNodes() {
    return { callout: { group: 'block', content: 'inline*', /* … */ } };
  },
  addExports() {
    const handler: SemanticNodeHandler = (node, ctx) => ({
      type: 'paragraph',                 // or a type your consumer understands
      text: ctx.toText(node),            // mark-aware; optional (walker would do this)
    });
    return { semantic: { nodes: { callout: handler } } };
  },
});
```

A node with **no** registered handler is never dropped — the walker emits a `type: "unknown"` unit with its text and warns once (in dev), so gaps are visible.

### A custom mark handler

A mark handler transforms or drops a text run while `text` is built. Return `null` (or an empty-text run) to remove it. This is how track changes keeps suggested-deletion text out of embeddings while preserving it as structured `changes`:

```ts
import type { SemanticMarkHandler } from '@scrivr/core';

// Drop a redacted run from embeddings, but record it for audit.
const redact: SemanticMarkHandler = (run, mark) => ({
  text: '',
  changes: [...(run.changes ?? []), { type: 'suggestedDelete', text: run.text }],
});

// in the mark's extension:
addExports() {
  return { semantic: { marks: { redaction: redact } } };
}
```

Formatting marks (bold, italic, …) need no handler — plain text is unaffected by default.

### The producer context (`UnitCtx`)

Handlers receive a `ctx` with:

- `toText(nodes)` — mark-aware plain text (folds mark handlers; excludes dropped runs).
- `toMarkdown(nodes)` — structure-preserving markdown via the editor's serializer.
- `toChanges(nodes)` — the review `changes` a mark handler emitted.
- `physicalColumns(table)` — a table's physical column count (Σ gridSpan, the safe basis).

### Per-call overrides

For one-off customization without touching an extension, pass `overrides` — they win over contributed handlers:

```ts
toSemanticUnits(editor, {
  overrides: { nodes: { paragraph: () => ({ type: 'unknown' }) } },
});
```

## Formatting: styling & inline marks

Markdown is a *lossy*, non-canonical view — it can't express alignment, indent, color, highlight, font, or review overlays safely. Treat `markdown` as a convenience only. When review `changes` are present, `markdown` is omitted so consumers do not accidentally mix proposed text with raw redline rendering.

- **`attrs`** — the block's own styling markdown can't carry (`align`, `indent`, `textIndent`, `fontFamily`, list start, …). Only non-default values; identity/level bookkeeping (`nodeId`, `dataTracked`, `level`) is removed. For a grouped heading+lede unit these are the anchor (heading) block's attrs.
- **`spans`** — the inline runs of the unit's text, each with its formatting marks and their attrs. It reconstructs the text exactly — `spans.map(s => s.text).join("") === text` — so a downstream agent knows precisely which text is bold, red, a link, etc., and can suggest edits that preserve formatting.

```jsonc
{
  "type": "paragraph",
  "attrs": { "align": "center", "indent": 2 },
  "text": "The Provider shall indemnify the Client per clause 4.",
  "spans": [
    { "text": "The ", "marks": [] },
    { "text": "Provider", "marks": [{ "type": "bold" }] },
    { "text": " shall indemnify the ", "marks": [] },
    { "text": "Client", "marks": [{ "type": "bold" }, { "type": "color", "attrs": { "color": "#dc2626" } }] },
    { "text": " per ", "marks": [] },
    { "text": "clause 4", "marks": [{ "type": "link", "attrs": { "href": "…" } }] },
    { "text": ".", "marks": [] }
  ]
}
```

Both are emitted only when there's something to report — a plain, default-styled paragraph carries neither, so units stay lean. Custom marks and block attrs come through automatically. Review marks (tracked changes) are **not** formatting: they stay in `changes`, and their runs are excluded from `spans`.

## Track changes

If `@scrivr/plugins`' `TrackChanges` is loaded, suggested-**deletion** text is excluded from `text`, breadcrumbs, and table-cell text (never embedded), and preserved as `changes` on the unit (and cell) with author / status / id / timestamps. Units with review changes omit `markdown`; use `text`/`spans`/`cells`/`changes` as the canonical data. Suggested-**insertion** text is kept, since it is proposed content.

## Determinism & stable ids

`toSemanticUnits` is deterministic: same document tree ⇒ same units (order, ids, breadcrumbs). Real stable ids come from the `UniqueId` extension (bundled in `StarterKit`), which assigns and persists a `nodeId` on every block at edit-time. Documents loaded without persisted ids use the positional fallback, which is stable per tree shape but not across edits — fine for a one-shot index, but persist real ids if you rely on incremental re-embedding.

## License

Apache-2.0
