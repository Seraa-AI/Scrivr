# Node declarations: breaks, outline levels, markdown paste

Status: Draft (2026-11-09), for sign-off.

## Problem

Wrapper layout (#238) moved lists out of the engine: a node's layout and look
are declared by its extension, and the engine never checks a node's name. Four
places still do:

| Where | What it knows by name |
|---|---|
| `layout/layoutItems.ts`, `layout/PageLayout.ts` | `pageBreak` starts a new page; its flow is labelled `"pageBreak"` |
| `layout/BlockLayout.ts` (span builder) | `hardBreak` ends the line |
| `export-pdf/src/outline.ts` | A bookmark is a `heading`, at its `level` attr |
| `input/PasteTransformer.ts` | A line-by-line markdown parser that builds `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `bold`, `italic` |

## Survey

- **Page break.** `NodeLayout` (on the node spec) already says how a node takes
  part in layout: `block` or `transparent`. A page break is neither: it has no
  box and holds nothing; it moves the flow to the next page.
- **Line break.** An inline leaf with no strategy, no size and no text. It
  reaches the span builder as a node like any other, and is caught by name
  before the inline-object path. It is the same kind of thing as a page break,
  one level down: Word writes both as `<w:br>`, with `w:type="page"` or
  none (`textWrapping`), and a column break is the same element with
  `w:type="column"`.
- **Outline.** The PDF exporter already takes each node's drawing from
  `addExports().pdf.nodes`, keyed by node name. What makes a block a bookmark,
  and at what level, belongs beside it.
- **Paste.** The token path (`MarkdownParser` over the tokens extensions declare
  through `addMarkdownParserTokens`) already builds every node the fallback
  builds. Probing the paste's own markdown-it configuration, the fallback runs
  in only two cases:
  1. `~~text~~`: Strikethrough declares no `s` token, so the parser throws.
  2. A pipe table when `Table` is not installed.

  In both, the fallback keeps the construct as literal text and parses the
  rest line by line. `addMarkdownRules` (`MarkdownBlockRule`) exists only for
  this fallback: `Heading` returns `[]`, and `HorizontalRule`'s `---` rule
  duplicates its `hr` token.

## Design

### 1. A node declares that it breaks: `NodeLayout { kind: "break" }`

```ts
type NodeLayout =
  | { kind: "block" }
  | { kind: "transparent"; wrap?: WrapperLayout }
  | { kind: "break"; breaks: "page" | "line" };
```

- `PageBreak` declares `layout: { kind: "break", breaks: "page" }`. The walk in
  `collectChildItems` emits a page-break item for any node whose layout breaks
  the page, and the flow's `blockType` is the node's own name.
- `HardBreak` declares `layout: { kind: "break", breaks: "line" }`. The span
  builder emits a `break` span for any inline node whose layout breaks the line.
- A break the context cannot honour is ignored, not guessed at: a block that
  declares `"line"` is a plain leaf block, an inline node that declares
  `"page"` is a plain inline leaf.

Why a third kind, when wrapper layout chose `wrap` on `transparent` over one:
a wrapper is a transparent node that also shapes what it holds, so it fits
inside `transparent`. A break is neither a box nor a container of blocks, and
it is the one layout fact both breaks share. Its `breaks` value leaves room for
`"column"` (columns RFC) without another kind.

`sectionBreak` stays as it is: it is found through the sections model
(`isSectionBreak`), which owns its settings and breaks only when its
`breakType` is not continuous. Moving it is the sections work's call.

### 2. An extension declares a block's outline level: `pdf.outline`

```ts
interface PdfHandlers {
  // …nodes, marks, chrome, as today
  /** Per-node outline level (1 = top) for bookmarks, keyed by node.type.name; null leaves the block out. */
  outline?: Record<string, (node: Node) => number | null>;
}
```

`Heading` declares `outline: { heading: (node) => level }`, reading its level
the way its DOCX handler does (clamped to its configured `levels`). The
exporter merges `outline` like `nodes`, and `outline.ts` asks the map for each
block's level. The title (the block's trimmed text) and the nesting rule are
unchanged.

The PDF lane is chosen over a spec-level field (Word's `outlineLvl` is a
paragraph property that also feeds the navigation pane and a TOC): the PDF
bookmark is its only reader today. When a second reader appears, the level
moves to the spec and `pdf.outline` reads it.

### 3. Markdown paste goes through the tokens only

- The line-by-line parser goes, with `parseInline` and `makeParagraph`.
- `Strikethrough` declares `s: { mark: "strikethrough" }`, so `~~text~~`
  pastes struck through, as the editor's own markdown export writes it.
- When the token parser throws (a construct no extension declares, such as a
  pipe table without `Table`), the paste is inserted as plain text — what the
  paste already does for blockquotes, links and images, whose rules it
  disables.
- `addMarkdownRules` and `MarkdownBlockRule` are removed. Markdown detection
  keeps its pattern; `HorizontalRule`'s `---` is already in it.

## Public API

Breaking, during beta (patch changesets):

- **Removed:** `addMarkdownRules` (extension hook), `MarkdownBlockRule`.
- **New:** `NodeLayout`'s `{ kind: "break"; breaks }`; `PdfHandlers.outline`.
- **Changed:** a page break's flow `blockType` is its node's name (the same
  `"pageBreak"` for the built-in node).

## How it is checked

- Every existing test keeps its assertions; only names change.
- A test-only extension, written against the public API only, declares a
  custom page break, a custom line break and a custom outline block, and each
  behaves as the built-in one does.
- The vocabulary guards (`core/src/layout/engineVocabulary.test.ts`,
  `export-pdf/src/__tests__/exporterVocabulary.test.ts`) grow: no source file
  under `layout/` or `renderer/` names `pageBreak` or `hardBreak`; none under
  `input/` names `heading`, `bulletList`, `orderedList` or `listItem`; none
  under `export-pdf/src` names `heading`.

`input/` still names `paragraph` (plain-text paste) and `image` (pasted image
files), and `layout/FontConfig.ts` keeps its `heading_N` style defaults; those
belong to the later passes.

## What shipped

Nothing yet.
