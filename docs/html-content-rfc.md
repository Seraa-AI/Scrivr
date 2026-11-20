# HTML content — RFC

Status: **Approved** — D1–D10 decided; Phase 1 in progress.

## Problem

Seraa drafts documents with an agent. Today the only rich format it can hand
Scrivr is Markdown, and Markdown has no vocabulary for most of what a drafted
document carries: alignment, colour, font family and size, highlight, indents,
table cell fills. HTML has all of it, and models write it fluently.

Scrivr has no way to load HTML as a document:

- `content: string` on `BaseEditor` / `ServerEditor` is parsed as Markdown.
  There is `editor.parseMarkdown()`, no HTML counterpart.
- The only HTML path is paste (`PasteTransformer.fromHtml`). It builds its tree
  with `document.createElement`, so it cannot run in Node — and Seraa's agents
  run headless on `ServerEditor` as well as in the browser.
- Paste cleaning is tuned for *foreign* HTML and deliberately throws intent
  away: it strips `background-color` from spans, every margin, and
  `line-height`, because from Google Docs those are page artefacts. In HTML an
  author wrote on purpose, they are the content.

## Goal

A host can load a whole document from HTML, in the browser and on the server,
and get back both the document and a list of what could not be represented.

Not in scope: inserting HTML at a position, HTML as an agent suggestion lane,
HTML export. Each is a later, separate decision.

## Decisions

### D1. A `@scrivr/html` package, shaped like `@scrivr/docx`

```ts
// Server — Seraa's agent drafts here
const editor = new ServerEditor({ extensions: [StarterKit] });
const { doc, diagnostics } = await importHtml(editor, html);
applyImportedDocument(editor, doc);

// Browser — same function, plus the extension for the toolbar
new Editor({ extensions: [StarterKit, HtmlImport] });
```

`@scrivr/docx` already set the pattern for loading a foreign format, and HTML
copies it piece for piece:

| `@scrivr/docx` | `@scrivr/html` |
|---|---|
| `importDocx(editor, bytes, options)` → `{ doc, diagnostics }` | `importHtml(editor, html, options)` → `{ doc, diagnostics }` |
| `DocxImport` extension: `importDocxFromFile` command + toolbar item | `HtmlImport` extension: `importHtmlFromFile` command + toolbar item |
| server calls `importDocx` directly | server calls `importHtml` directly |
| `applyImportedDocument(editor, doc)` | the same function |

`importHtml` is async, like `importDocx`, because the server DOM loads lazily
(D2).

**Moved:** `applyImportedDocument` moves from `@scrivr/docx` to `@scrivr/core`,
and `@scrivr/docx` keeps re-exporting it so no caller breaks. Both importers
need it, and `@scrivr/html` should not depend on `@scrivr/docx` to get it. The
body stays the same: it already marks the load as not authored, for Track
Changes.

The `parseDOM` rules `importHtml` runs stay where they are, on core's
extensions, so paste and import share one rule per tag. The HTML-only pieces
live in `@scrivr/html`: the cleaning step, stylesheet inlining and the
diagnostics.

### D2. The browser's DOM in the browser, happy-dom on the server

The server is the main path, because Seraa's agent drafts there. So it has to
work with no setup:

- When `globalThis.DOMParser` exists (browser), `importHtml` uses it.
- Otherwise it loads `happy-dom` with a lazy `import()` and parses with a
  `Window` that runs no scripts and fetches nothing. A browser bundle never
  pulls happy-dom in.

`happy-dom` becomes a dependency of `@scrivr/html`. It is already in the repo:
`@scrivr/react` uses it for tests, and core's tests run under it. That means
the server path runs on the same DOM the tests use. Core still has no DOM
dependency.

### D3. Authored HTML and pasted HTML are cleaned differently

`cleanPastedHtml` splits into the steps that are true of all HTML (drop
`<script>`, `<meta>`, `<link>`; non-breaking spaces to spaces) and the steps
that undo a foreign editor's noise (Google Docs wrappers and `<hr>` spacers,
Word `mso-list`, stripping span backgrounds, margins, default black). Paste
runs both; `importHtml` runs only the first. The split happens in place — no
second cleaner.

### D4. Styles are read from the `style` attribute, not `el.style`

Several `getAttrs` read `el.style.textAlign` and friends. That relies on the
DOM implementation's `CSSStyleDeclaration`, which server DOMs implement only
partly. A shared `readStyle(el)` parses the `style` attribute string once and
every `getAttrs` reads from it — same result in every DOM. (ProseMirror's own
`style:` rules already parse the attribute string, so mark rules are fine.)

### D5. `<style>` blocks are inlined before parsing — simple selectors only

Models often write `<style>.lead { font-size: 14pt }</style>` instead of inline
styles. Before parsing, `importHtml` applies stylesheet rules onto matching
elements' `style` attribute, inline declarations winning. Supported selectors:
type, `.class`, `#id`, `type.class`, comma lists, in specificity order. Any
other selector is skipped and reported (D6). No CSS library: this is a small,
bounded cascade, not a browser engine.

### D6. Every dropped intent is reported

`diagnostics` uses the DOCX import diagnostic shape (`{ level, code, message }`), with codes
such as `html-style-unsupported` (property + count), `html-element-unknown`,
`html-selector-unsupported`, `html-url-rejected`. The agent can read them and
rewrite. Silence would make Seraa guess why a style vanished.

### D7. Fill the gaps the schema can already hold

These are rules missing from extensions whose node/mark already exists — no
schema change, no export work:

| HTML | Today | After |
|---|---|---|
| `<span style="background-color">` | dropped (only `<mark>` parses) | `highlight` (multicolor) |
| `margin-left` / `text-indent` in `pt`, `in`, `em`, `cm` | unit ignored (`1in` → indent 0) | converted to px first |
| `text-align: justify / start / end` | passed through raw | mapped to the `align` values |
| `<font color face size>` | dropped | `color` / `fontFamily` / `fontSize` |
| `color` / `font-*` on `<p>`, `<h1>`, `<td>` | depends on rule | applies to the block's text |
| `<div>` holding text | depends on nesting | a paragraph with the div's alignment |
| `<td style="background-color / width">` | to verify | cell fill / column width |

Each row lands with a test that runs `importHtml` on a real `ServerEditor` +
`StarterKit` under the node environment, which is Seraa's path. The fix itself
goes in the owning extension's `parseDOM`, so paste gets it too.

### D9. Block ids in the HTML are kept

If an element carries `data-node-id`, the block keeps that id. Seraa's agent
can then refer to blocks it wrote, and Scrivr's own copied HTML loads back with
the same ids. The rules are the existing ones from load:

- blocks without an id get one assigned;
- when two blocks in the HTML share an id, the first keeps it and the others
  get new ones (`planDuplicateIdAssignments`), because ids must be unique at
  the source.

Paste is different: it still re-mints every id, because a pasted block is a
copy of a block that still exists elsewhere.

### D8. What the schema cannot hold stays out of this RFC

`line-height`, space before/after, `<sub>`/`<sup>`, inline `<code>`,
`<ol type>` / `list-style-type` (ordered lists have no numbering-kind attribute),
`<blockquote>`, paragraph borders and shading. Each needs a new node, mark or
attribute **plus** PDF and DOCX export parity, so each is its own change
(paragraph borders already have `docs/paragraph-borders-rfc.md`). Until then,
D6 reports them.

### D10. HTML import is part of what a feature has to ship with

This RFC covers what the schema holds today, which is more than Markdown can
express. From here on, each new node, mark or attribute ships with:

- a `parseDOM` rule,
- a test that runs that HTML through `importHtml`,

alongside the PDF and DOCX parity it already needs. A feature Seraa can't write
in HTML isn't finished.

## Phases

1. **Server import.** Create the `@scrivr/html` package with `importHtml`, the
   DOM selection (D2), the cleaner split (D3), `readStyle` (D4), diagnostics
   (D6) and id keeping (D9). Move `applyImportedDocument` into core. Tests use
   a real `ServerEditor` in node.
2. **Browser extension.** Add the `HtmlImport` extension and wire it into the
   playground next to `DocxImport`.
3. **D7 coverage**, one row at a time.
4. **D5**, stylesheet inlining.
5. **D8 schema additions**, each as its own feature under D10.

## Decided

- Package and extension follow `@scrivr/docx`: `importHtml`, `HtmlImport`,
  `applyImportedDocument`. *(user, 2026-11-20)*
- The server DOM is happy-dom. *(user, 2026-11-20)*
- Server first, because Seraa's agent drafts there. *(user, 2026-11-20)*
- Ids in the HTML are kept. *(user, 2026-11-20)*
- Scope is what the schema supports today. New features stay compatible by
  shipping their HTML rule (D10). *(user, 2026-11-20)*

## What shipped

**Phases 1–4** (`feat/html-content`):

- `@scrivr/html` with `importHtml(editor, html)`. It picks the DOM per D2,
  keeps ids per D9 and runs no cleaner. It is tested in node, which is Seraa's
  path, and under happy-dom as a browser.
- **D2 changed how the DOM is chosen.** A lazy `import("happy-dom")` still
  made browser bundlers build happy-dom into a dead chunk and print a warning
  for each Node built-in it imports. Instead, the package has two entries,
  routed by the standard `browser` export condition:
  - browser bundlers get an entry that only knows the page's `DOMParser`;
  - Node gets the happy-dom entry.

  Seraa still writes `import { importHtml } from "@scrivr/html"` everywhere.
  A browser app's server-rendering bundle runs in Node, so it gets the
  happy-dom entry as it should.
- **Phase 2:** the `HtmlImport` extension (`importHtmlFromFile` plus a
  toolbar item) is in the playground next to `DocxImport`. The file picker
  moved from `DocxImport` into core as `pickFile(accept)`, and both
  extensions use it.
- `applyImportedDocument` moved to core.
- **Phase 3, D7 coverage.** The rules live in the extensions, so paste reads
  them too:
  - CSS lengths in any unit (`px`, `pt`, `in`, `cm`, `mm`, `em`, `rem`) for
    indents and font size. `font-size:1.5em` was 1.5px before.
  - Alignment mapped onto the four the editor has. `start` and `end` were
    stored raw before, which layout doesn't recognise.
  - A `span` with a background becomes a highlight.
  - `<font color face size>` applies all three marks. The rules are
    non-consuming so they don't block each other.
  - A `div` holding only text becomes a paragraph with its alignment.

  The paragraph and heading rules now share `blockStyleAttrs` instead of two
  copies of the same code. Block-level text styles and cell fills already
  worked; tests now cover them.
- **Phase 4, D5 stylesheets.** `<style>` rules, in `<head>` or `<body>`, are
  applied onto each element's `style` attribute before parsing:
  - Selectors are checked first (type, `#id`, `.class`, compounds and comma
    lists), then matched with the DOM's own `querySelectorAll`.
  - An inline declaration beats every rule, then specificity decides, then
    source order.
  - `<body>`/`<html>` can't be read by the parser, so their inherited
    properties (font, color, alignment, line height, indent) are handed down
    to every element that doesn't set its own. Their other properties, such
    as the page `margin`, are reported.
  - Other selectors and at-rules are reported as `html-selector-unsupported`.
- **Moved from D7 to D8:** `<ol type>`. Ordered lists have no numbering-kind
  attribute, so supporting it is a schema change. `@scrivr/docx` and `@scrivr/html`
  both re-export it.
- **Found while building, fixed at the seam:** the parse rules for links,
  images, tables, fields, section breaks and sourced blocks checked
  `instanceof Element` / `HTMLElement`. On a server those globals don't exist,
  so the import threw. A shape check, `isHtmlElement` (exported from core),
  replaces them, so the rules read HTML from any DOM. Paste uses the same
  rules.
- **D3 turned out to need no split.** The import runs no cleaning at all,
  because ProseMirror already skips `<script>`, `<style>` and `<head>`.
  `cleanPastedHtml` is unchanged and still runs only on paste.
- **D4 isn't needed with happy-dom.** Its `el.style` reads alignment, margin
  and indent correctly, which the tests confirm. `readStyle` would only matter
  for a DOM that doesn't implement `style`.
- **D6 diagnostics, with no hand-kept list.** The schema's rules decide what
  "supported" means. A style rule names the property it reads, and each tag
  rule's `getAttrs` is watched through a proxy for the `style` properties it
  reads off the element it was given. Anything the HTML says that no rule read
  is reported once per kind, with a count:
  - `html-style-unsupported`
  - `html-element-unknown`
  - `html-element-ignored`
  - `html-element-rejected`

  A style is judged on the element that carries it, so `margin-left` counts
  as indent on a `<p>` but is reported on a `<span>`. Under D10, a feature that
  ships its parse rule stops being reported automatically.
