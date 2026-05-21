---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/docx` — add DOCX import. The package now round-trips: import a
`.docx` to a ProseMirror `Node` against the editor's schema, edit, and
re-export with semantic fidelity for everything the playground exercises.

Same architectural shape as the export side:

**Contract types in core**
- `@scrivr/core/exports/docx.ts` is the single source of truth for both
  directions. New: `DocxImports` (blocks/paragraphStyles/marks/inlines +
  lifecycle hooks), `DocxImportContext` (mirror of `DocxContext` with
  `resolveImage` / `resolveHyperlink` instead of `addImage` / `addHyperlink`),
  `DocxBlock` / `DocxInline` / `DocxMark` for the normalized intermediate
  model the parser emits.
- `addImports()` extension lane added to `Extension`, collected by the
  manager alongside `addExports()`.

**Two-stage pipeline**
- **Stage 1 — parser** (`packages/docx/src/import/parser.ts`). OOXML-pure;
  no ProseMirror awareness. Emits `DocxImportModel { blocks: DocxBlock[] }`.
  Tolerates real Word output via allowlists for ignorable metadata
  (bookmarks, `proofErr`, comment markers, `smartTag`, permission ranges).
  Hyperlinks survive as `link` marks carrying relId/anchor/history;
  inline `<w:br w:type="page"/>` splits the surrounding paragraph;
  toggle rPr (b/i/u/strike/...) is normalized via `parseOnOff` so
  `<w:b w:val="false"/>` drops the mark instead of reaching Stage 2.
  Images deep-look for `<a:blip>` to tolerate non-standard drawingML
  nesting and preserve `relativeFrom` on positionH/positionV.
- **List reconstruction** (between stages) — flat `numPr` paragraphs →
  nested `bulletList > listItem > paragraph` trees. Handles mixed nested
  lists (bullet outer, ordered inner): nested paragraphs with a different
  numId at `ilvl > 0` stay in the same run instead of splitting into
  separate top-level lists.
- **Stage 2 — transform** (`transform.ts`). Dispatches via extension
  contributions plus per-call overrides. Three dispatch lanes mirror
  export: `blocks[block.type]`, `paragraphStyles[styleId]`,
  `marks[mark.kind]`, plus a new `inlines[inline.type]` lane for images.
  Handlers return real PM `Node` / `Mark` instances — no invented JSON
  shape to drift from ProseMirror.

**Built-in import handlers (extension owns its import)**
- Heading — paragraphStyles dispatch for `Heading1`/`Heading2`/`Heading3`.
- Marks: bold, italic, underline, strikethrough, color, highlight
  (named `val` and hex shading), fontSize (half-points → px),
  fontFamily, link (relId → URL via `ctx.rels.resolveHyperlink`).
- Image — five wrap modes (`inline` / `square` / `topAndBottom` /
  `behind` / `front`) with rel-resolved src.
- HorizontalRule — Stage 1 detects Word's empty-paragraph-with-bottom-
  border convention and emits a `horizontalRule` block (matches the
  export side's output shape).
- CodeBlock, PageBreak, Paragraph fallbacks live in the transform.

**Media materialization** (`media.ts`)
- `options.media`: `"data-url"` (default, base64 `data:` URL, works
  everywhere) / `"object-url"` (`URL.createObjectURL(blob)`, browser-only)
  / `"drop"` (emit no `src`, record a diagnostic — caller handles uploads).

**Unsupported policy honored on both sides**
- Parser emits `unsupported-docx-element` for any unmodeled body child
  (tables, sdt, etc.) with an explicit ignorable allowlist for harmless
  markup. Transform emits `unsupported-block` / `unsupported-mark` for
  unknown kinds. `importDocx` escalates to `DocxImportError` post-pipeline
  when `options.unsupported === "throw"`. Mirrors export-side semantics:
  any content loss is fatal under `throw`, silent (but diagnosed) under
  `drop`/`placeholder`.

**`DocxImport` extension** (`packages/docx/src/import/DocxImport.ts`)
- Toolbar button + file-picker flow. Opens a native `<input type="file">`,
  runs `importDocx`, replaces the editor's doc via
  `tr.replaceWith(0, doc.content.size, …)` — the same pattern the collab
  YBinding uses for hard resets. Browser-only; server callers continue
  to use `importDocx(editor, bytes)` directly.
- Playground wires the icon (Lucide `FileUp`) into the toolbar `ICON_MAP`
  next to `⬇ DOCX` and registers the extension in both the collab and
  standalone extension lists.

**Tests**
- 33 import tests in `import.test.ts`. Round-trips through
  `exportDocxBytes`: build a known doc, serialize → bytes, parse bytes →
  PM `Node`, assert structure. Covers all built-in marks, headings, code
  blocks, page breaks, horizontal rule, bullet/ordered/nested/mixed-nested
  lists, all five image wrap modes (inline + four anchored), drop policy,
  extension dispatch.
- 4 dedicated tests for code-review fixes: HR round-trip, mixed-nested
  list reconstruction, `unsupported-docx-element` diagnostic, `throw`
  policy escalation.
- Full `@scrivr/docx` suite at 105 tests (export 72 + import 33).

Other packages: lockstep version bump, no behavior change.
