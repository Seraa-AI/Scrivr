---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/export-docx` — lock the DOCX export base contract. Replaces the
type-only skeleton with a real, deterministic pipeline that ships an
openable `.docx`. Built so feature PRs (paragraph/heading/list/table/image)
can add handlers without renegotiating the contract.

The base PR ships the pieces that are expensive to change later:

**Contract (locked)**
- `DocxNodeHandler(node, children, ctx, meta)` — walker owns recursion and
  passes already-composed child XML in; handlers wrap or position it.
- `DocxMarkHandler(props, mark, ctx) → DocxRunProps` — marks accumulate
  into a run-property bag, never wrap XML, so `bold(italic(...))` cannot
  produce nested `<w:r>` (invalid OOXML).
- `DocxRunProps` reserves `trackedInsert`/`trackedDelete` fields. The
  walker intentionally does NOT emit `<w:ins>`/`<w:del>` — track-changes
  XML lands in a dedicated feature PR with author/date/comment-range
  semantics.
- `DocxExportResult { bytes, diagnostics }` from `exportDocx()` — DOCX
  is inherently lossy, so the API surfaces fidelity warnings from day
  one. `exportDocxBytes()` is the ergonomic alias.
- `DocxExportError` carries `diagnostics` so fatal failures preserve the
  warnings that preceded them.
- `options.unsupported: "drop" | "placeholder" | "throw"` and
  `options.fidelity: "strict" | "compatible" | "best-effort"` — value
  types locked even though only `"drop"` and `"compatible"` are honored
  by the base walker (feature PRs branch on these without touching the
  contract).

**Pipeline**
- `collect → createContext → onBeforeExport → walk → onBuildTreeComplete
  → finalize / default packager → zip`.
- `walkDocument` skips the implicit root, returns body XML; default
  packager wraps it in `<w:document>/<w:body>` plus a US-Letter sectPr.
- `createDocxContext` exposes producer registries (`styles.getOrCreate`,
  `numbering.getOrCreate`, `rels.addImage/addHyperlink`, `media.add`,
  `diagnostics.warn/error`, `shared.getOrInit`) backed by an internal
  `DocxBuildState` the OPC builder walks.
- `buildDocxPackage` emits all required OPC parts:
  `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`,
  `word/_rels/document.xml.rels`, `word/styles.xml`, `word/numbering.xml`,
  `word/settings.xml`, plus media parts and extension content-type
  defaults per unique extension.
- Internal document rels use stable named IDs (`rIdStyles`,
  `rIdNumbering`, `rIdSettings`) so they never collide with user-allocated
  `rId{n}` IDs.

**Serializer**
- `xml(name, attrs?, children?)` builder + `serializeXml(root, opts?)`
  with alphabetical attribute ordering for golden-test stability and
  proper XML escaping for both text and attribute values.
- `xml:space="preserve"` is automatically applied to text runs with edge
  whitespace.

**Mark merging**
- `<w:rPr>` children emitted in OOXML spec order (`rStyle`, `rFonts`,
  `b`, `i`, `strike`, `color`, `sz`, `highlight`, `u`).
- Run-prop conversion: `fontSize` (px) → half-points (×1.5), `color`
  strips leading `#`, `code` mark sets Courier New `rFonts` when no
  explicit `fontFamily`.

**ZIP**
- `fflate` (`zipSync`) — small (~8KB), zero deps, browser + Node compatible.
- `mtime` pinned to the ZIP epoch so identical input produces identical
  bytes (deterministic for content-addressable storage and golden tests).

**Tests**
- 49 unit tests across `xml`, `walker`, `package`, `defaults`,
  `exportDocx`. Walker tests drive a real `ServerEditor` + StarterKit
  schema (no fake nodes / fixtures) — exercises text emission,
  whitespace preservation, mark merging into a single run, missing-mark
  warnings, all three unsupported policies, font-size unit conversion,
  and the reserved track-changes fields (verifies no `<w:ins>`/`<w:del>`
  emission yet).
- End-to-end test exports a `ServerEditor` doc, unzips the bytes, and
  asserts every required OPC part is present and well-formed.

Other packages: lockstep version bump, no behavior change.
