---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

DOCX image export — `image` node now exports to `<w:drawing>` with all five
Scrivr wrap modes mapped to the corresponding OOXML wrap elements. Embedded
as binary parts under `word/media/`, referenced by document-level rels.

**Where it lives**
- `packages/core/src/extensions/built-in/Image.docx.ts` — the extension owns
  its DOCX export shape. Uses LOCAL structural type stand-ins (no runtime
  imports of `@scrivr/export-docx`) so the dependency direction stays
  one-way (export-docx → core). The integration test in `@scrivr/export-docx`
  asserts the local types stay structurally compatible with `DocxContext`.
- Image extension's `addExports()` returns `{ docx: imageDocxContribution }`.
  StarterKit got a new `addExports()` that aggregates sub-extension
  contributions (format-aware merge: `nodes`/`marks` combine, lifecycle
  hooks chain, `onFinalize` is last-writer-wins) — Image's docx
  contribution now propagates through StarterKit to the export pipeline.

**Wrap-mode mapping (Scrivr → OOXML)**
| Scrivr `wrapMode` | OOXML wrapper       | Wrap element                  |
|-------------------|---------------------|-------------------------------|
| `inline`          | `<wp:inline>`       | (atom inside `<w:r>`)         |
| `square`          | `<wp:anchor>`       | `<wp:wrapSquare wrapText=…/>` |
| `top-bottom`      | `<wp:anchor>`       | `<wp:wrapTopAndBottom/>`      |
| `behind`          | `<wp:anchor behindDoc="1">` | `<wp:wrapNone/>`      |
| `front`           | `<wp:anchor behindDoc="0">` | `<wp:wrapNone/>`      |

**Pipeline**
- `onBeforeExport` walks the doc once, collects unique `image.src` values,
  fetches the bytes (data URLs decoded synchronously; http(s) via `fetch`),
  sniffs MIME from magic bytes (PNG / JPEG / GIF / WebP — fallback PNG),
  registers media + rel via `ctx.media.add` / `ctx.rels.addImage`, and
  stores `Map<src, ImageRecord>` under `ctx.shared["docx:images"]`.
- Sync `image` node handler reads the precomputed record, picks
  `<wp:inline>` for `wrapMode: "inline"` and `<wp:anchor>` for the four
  float modes, with the right wrap element per mode.

**Unit + position**
- `pxToEmu(px)` = `round(px × 9525)` (1px @ 96 DPI = 9525 EMU).
- Anchored position: `xAlign: left | center | right` → `<wp:align>`;
  literal `x` (px) → `<wp:posOffset>` in EMU relative to column; `yOffset`
  (px) → `<wp:posOffset>` relative to paragraph; `margin` (px) → all four
  `dist*` attrs.

**Base contract tweak**
- `DocxContext.editor: IBaseEditor` — lifecycle hooks like
  `onBeforeExport` need the doc to walk it for resource precomputation.
  Previously hooks only received `ctx` with no way back to the source.

**Tests**
- 8 integration tests across all 5 wrap modes, dedup by src,
  fetch-failure diagnostic, EMU conversion sanity. Mocked `fetch`
  serves a real 1×1 PNG so the bytes survive ZIP encode/decode.

Other packages: lockstep version bump, no behavior change.
