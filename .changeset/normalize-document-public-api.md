---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — ingestion-time `normalizeDocument` and `ServerEditor`
wire-up.

**New public API**

```ts
import { normalizeDocument } from "@scrivr/core";

const result = normalizeDocument(jsonFromAi, {
  schema: editor.manager.schema,
  // optional knobs
  mode: "repair",          // or "strict" — strict throws on bounds breach
  assignIds: true,         // default — stamp nodeId on blocks missing one
  generate: () => uuid(),  // override the ID generator (deterministic in tests)
  maxNodes: 5000,          // bounds check
  maxDepth: 50,
});

// result.doc         — normalized PM Node
// result.warnings    — per-stage diagnostics (urls-sanitized, tables-normalized,
//                       ids-assigned, bounds-exceeded)
// result.fingerprint — FNV-1a 8-hex-char hash, deterministic per doc shape
// result.changed     — true when normalization mutated the input
```

Pipeline composes the existing primitives in one pass:

1. `schema.nodeFromJSON(input)` — schema validation
2. bounds check (maxNodes / maxDepth)
3. `sanitizeDocUrls` — URL allow-list
4. `normalizeTablesDoc` — table integrity (gridSpan / vMerge / grid)
5. `assignBlockIds` — stable `nodeId` on every id-bearing block
6. fingerprint over a deterministic stringification of `doc.toJSON()`

Warnings are aggregate per stage (`{ code, message, count? }`) — enough
for an AI server-side review pipeline to decide "did the model output
something that needed repair?" without diffing two trees.

**`ServerEditor.setContent` now routes through `normalizeDocument`**.
The previous standalone `sanitizeDocUrls` call is gone; the same URL
gate still runs as one stage of the new pipeline, plus table repair
and ID assignment that previously only happened inside a live editor
transaction. The result lives on `editor.lastNormalizeResult` for
consumers that want to inspect warnings (e.g. reject AI output
containing `urls-sanitized`).

**Behaviour delta** — `ServerEditor.setContent` now also stamps node
IDs and repairs tables on initial load instead of waiting for the
first transaction. This brings server-side ingestion to parity with
the live editor (where the `UniqueId` and table-integrity plugins
were already doing it incrementally). Existing tests pass unchanged
(core 1100/1100, plugins 328 + 5 skipped).

Other packages: lockstep version bump, no behavior change.
