# Markdown Ingestion Support Plan

Status: **design** — surfaced by `packages/core/src/model/parseMarkdown.stress.test.ts` (2026-05-24). Three rounds of work, sequenced smallest-to-largest, to bring Scrivr's markdown ingestion from "basic CommonMark subset" to "what every consumer actually expects."

---

## Why

A diagnostic stress test ran 43 markdown features through `ServerEditor`'s ingestion path (markdown string → `parseMarkdownToDoc` → `EditorState`). **Today: 26 supported, 5 lossy, 12 throw.** The failures aren't exotic — they're the everyday markdown features any consumer feeding the editor a document expects to work:

- Inline code, links (inline / reference / autolink), images, strikethrough, blockquotes, tables — these are not edge cases.
- The schema *already has* nodes and marks for most of them (link, image, strikethrough, code mark candidate). What's missing is the markdown-side bridge (`addMarkdownParserTokens()` + `addMarkdownSerializerRules()`) on the corresponding extensions.

The new `normalizeDocument` ingestion pipeline (PR #95) guarantees JSON-fed docs are URL-safe, table-repaired, and ID-stamped. The markdown-fed path on the other hand currently crashes on `~~strike~~`. Round 1 closes that gap with extension-side wiring; Round 2 adds the one missing schema node (blockquote) plus tables/HTML; Round 3 defers genuinely-advanced features.

---

## Stress matrix (current state)

| Bucket | Count | Examples |
|---|---|---|
| **Supported** | 26 | H1–H3, H6, paragraph, hr, fenced code (3 forms), bullet/ordered/nested/mixed lists, task lists *(list-only, no checkbox semantics)*, bold (`**` and `__`), italic (`*` and `_`), bold-italic, hard break (2-space + backslash), escaped chars, html entity |
| **Throws** | 12 | inline code, link (inline / ref / autolink), image (3 forms), strikethrough, blockquote (+ nested), table, footnote ref+def |
| **Lossy** | 5 | underline (`<u>` — no md syntax), raw URL autolink, definition list, math inline, math block |

Two surprises in the "supported" bucket:
- **Task lists are reported supported** because `[ ]` and `[x]` parse as `listItem` containing plain text. No checkbox node, no interactive semantics — functional for display, lossy for meaning.
- **Raw HTML cases pass** because `markdown-it { html: false }` makes the tags become text. Not actually rendered as HTML — worth a separate test asserting this explicitly.

---

## Root causes by category

| Category | Cases | What's missing |
|---|---|---|
| Existing schema, missing markdown bridge | 5 — link, image, inline code, strikethrough, +5 more (each link variant) | `addMarkdownParserTokens()` / `addMarkdownSerializerRules()` on the corresponding extensions |
| Missing schema node | 1 — blockquote (+ nested) | Net-new node, extension, layout strategy, PDF + DOCX exports |
| Markdown-it default config | 2 — table, linkify (raw URL) | Explicit `markdown-it` config + tokens on existing Table extension |
| Out of scope for v1 | 5 — footnote, definition list, math inline, math block, task-list checkbox semantics | New schema + UI affordances + serialization |
| Misclassified "supported" | 2 — raw HTML block, raw HTML inline | Behaviour is "becomes text content"; needs an explicit assertion test |

---

## Round 1 — wire existing extensions to markdown

**Highest leverage.** Schema is already there; we add the bridge. Each item ships as its own PR (or one bundle if reviewed together).

### Link

`packages/core/src/extensions/built-in/Link.ts`

```ts
addMarkdownParserTokens() {
  return {
    link: {
      mark: "link",
      getAttrs: (tok) => ({
        href:   tok.attrGet("href"),
        target: tok.attrGet("target") ?? null,
      }),
    },
  };
},
addMarkdownSerializerRules() {
  return {
    marks: {
      link: {
        open:  "[",
        close: (state, mark) => `](${state.esc(mark.attrs["href"])})`,
        mixable: true,
      },
    },
  };
}
```

Tests: inline `[text](url)`, reference `[text][ref]`, autolink `<https://…>`. URL allow-list (`safeUrl`) applies as usual at ingestion time.

### Image

`packages/core/src/extensions/built-in/Image.ts`

```ts
addMarkdownParserTokens() {
  return {
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src:   tok.attrGet("src"),
        alt:   tok.children?.[0]?.content ?? "",
        title: tok.attrGet("title") ?? null,
      }),
    },
  };
},
addMarkdownSerializerRules() {
  return {
    nodes: {
      image(state, node) {
        const attrs = node.attrs as { src?: string; alt?: string; title?: string | null };
        const alt   = state.esc(attrs.alt ?? "");
        const src   = state.esc(attrs.src ?? "");
        const title = attrs.title ? ` ${JSON.stringify(attrs.title)}` : "";
        state.write(`![${alt}](${src}${title})`);
      },
    },
  };
}
```

Tests: inline image, image with title, reference image.

### Inline `code` mark

There is no `code` mark in the schema today — only `codeBlock` for fenced code. Decision: either add a new `Code` extension/mark, or treat inline code as a styled span.

Recommended: new `Code` mark, paralleling other marks (bold, italic). The `markdown-it` token is `code_inline`. The mark's `parseDOM` maps `<code>`; `toDOM` emits `<code>`.

`packages/core/src/extensions/built-in/Code.ts` *(new)*

```ts
addMarks() {
  return {
    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
      excludes: "_",   // can't combine with most marks
    },
  };
},
addMarkdownParserTokens() {
  return { code_inline: { mark: "code" } };
},
addMarkdownSerializerRules() {
  return {
    marks: {
      code: { open: "`", close: "`", escape: false },
    },
  };
}
```

Tests: inline code, mixed inline code + bold, escape handling.

### Strikethrough

`packages/core/src/extensions/built-in/Strikethrough.ts` *(verify exists; mark already in the schema)*

```ts
addMarkdownParserTokens() {
  return { s: { mark: "strikethrough" } };
},
addMarkdownSerializerRules() {
  return {
    marks: {
      strikethrough: { open: "~~", close: "~~", mixable: true },
    },
  };
}
```

Tests: simple strike, strike + bold, strike across word boundary.

### Linkify raw URLs

`packages/core/src/model/parseMarkdown.ts`

```ts
// Before:
const md = new MarkdownIt({ html: false });

// After:
const md = new MarkdownIt({ html: false, linkify: true });
```

Requires Link tokens to be wired (above). Tests: bare `https://example.com` in a paragraph produces a `link` mark.

**Round 1 outcome:** 26 → 36 supported (10 new), 17 → 7 failing.

---

## Round 2 — schema additions

### Blockquote

Net-new extension. `packages/core/src/extensions/built-in/Blockquote.ts`

- **Schema node:** `group: "block", content: "block+", parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0]`
- **Layout strategy:** new `BlockquoteStrategy` (or `TextBlockStrategy` variant) with left border + left indent
- **Commands:** `wrapInBlockquote`, `lift` (from quote), `Tab` keymap
- **PDF export:** chrome handler that draws the left border + indented content
- **DOCX export:** `<w:p>` with `w:pStyle="Quote"`, per `feedback_pdf_parity.md`
- **DOCX import:** `Quote` paragraph style → blockquote node
- **Markdown:** `blockquote_open`/`blockquote_close` tokens, serializer prefix `> `
- **Tests:** simple quote, nested quote (`>>`), quote with mixed content

### Table markdown

The Table extension exists but is opt-in (`StarterKit.configure({ table: true })`) and has no markdown bridge.

- Enable `markdown-it`'s table parser
- Wire `table_open`, `thead_open`, `tbody_open`, `tr_open`, `th_open`, `td_open` token mappings on the Table extension
- **Decision needed:** should the Table extension be default-on now that DOCX import depends on it and consumers expect tables in markdown? (Currently off per `project_tables_plan` memory — `chore/tables-default-off` was deleted as merged.) Worth revisiting.

### Underline via paste

No markdown syntax for underline. The mark is in the schema. The gap is HTML paste — `<u>` should preserve the mark.

`packages/core/src/extensions/built-in/Underline.ts`

```ts
// Add to parseDOM:
[{ tag: "u" }, { style: "text-decoration", getAttrs: (v) => v === "underline" && {} }]
```

Document in `Underline.ts` JSDoc that markdown has no underline syntax — consumers who need it should round-trip via HTML or set the mark programmatically.

**Round 2 outcome:** 36 → 40 supported (4 new).

---

## Round 3 — deferred

| Feature | Deferral reason |
|---|---|
| Footnotes | Requires new schema (footnote ref + def), sidebar/popover UI, navigation. Multi-day effort. Defer until a real consumer asks. |
| Definition lists | Requires new schema (`dl`, `dt`, `dd`). Limited demand in product workflows we know about. |
| Inline math (`$E = mc^2$`) | Requires render strategy (KaTeX or MathJax), serialization, math input UX. |
| Block math (`$$ … $$`) | Same dependencies as inline math. |
| Task list checkboxes | Currently parsed as `listItem` with text "[ ] task". Real interactive checkbox needs a `taskItem` node + click handler + state mutation. Functional-but-lossy is acceptable until a real consumer asks. |

Document each as a `// TODO(roadmap):` comment near the relevant area.

---

## Sequencing

1. **Round 1 — one PR, ~1–2 days.** All five items land together; small diffs, mechanically similar. Update the stress test as cases convert from `expect.fail` to passing.
2. **Round 2 — three PRs.** Blockquote ships first (largest, includes layout + exports), then Table markdown bridge, then Underline paste. Each ships independently.
3. **Round 3 — defer.** Re-open this plan when a real consumer makes a request.

After Round 1+2: **40/43 supported (93%)**. The remaining 3 are explicit deferrals.

---

## What to do with the stress test today

`packages/core/src/model/parseMarkdown.stress.test.ts` currently has 17 red cases. Three options:

1. **Recommended:** convert each failing case to `it.skip(label, ...)` with a one-line comment referencing this plan + the round it belongs to. The test stays as a permanent diagnostic; flip skips off as each round lands.
2. Keep failing — treat the file as a living TODO list, accept the CI noise.
3. Delete the file — the data is captured here; not recommended (loses the regression catcher).

---

## References

- Stress test: `packages/core/src/model/parseMarkdown.stress.test.ts`
- Markdown parser entry: `packages/core/src/model/parseMarkdown.ts`
- Extension token contribution lane: `packages/core/src/extensions/Extension.ts` (`addMarkdownParserTokens`, `addMarkdownSerializerRules`)
- Examples of existing wiring: `Paragraph.ts`, `List.ts`, `Italic.ts`, `Bold.ts`, `Heading.ts`, `HardBreak.ts`, `CodeBlock.ts`, `HorizontalRule.ts`
- Companion: `docs/features-roadmap.md` — "Markdown Ingestion" subsection points here
