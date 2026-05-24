---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — extract pure-function normalization primitives from the
plugin layer in preparation for a public `normalizeDocument` entry point.

**New core exports** (`@scrivr/core`):

- `assignBlockIds(doc, { generate? })` — pure function that stamps a
  stable `nodeId` onto every block whose schema declares the attr but
  whose current value is `null`. Returns the same `Node` reference when
  nothing needed assignment (fast-path), so callers can detect a no-op
  cheaply. Mirrors the shape of `sanitizeDocUrls`.
- `planBlockIdAssignments(doc, { generate? })` — sibling for
  transaction-grain callers. Returns one `{ pos, attrs }` entry per
  block that needs an ID, so the caller can emit one `setNodeMarkup`
  step per block instead of a whole-doc replace (better grain for
  history and collab).
- `normalizeTablesDoc(doc, schema)` — doc-level wrapper around the
  existing `normalizeTables(state)` so table-integrity repair is
  reachable without materialising an `EditorState`. Same fast-path
  semantics.

**`@scrivr/plugins`** — `UniqueId` plugin no longer carries its own
walk. `appendTransaction` calls `planBlockIdAssignments(newState.doc)`
and translates the result into `setNodeMarkup` steps. Single source of
truth for the "which blocks need IDs?" predicate, so server-side and
AI ingestion paths apply identical semantics to the live editor.

Behaviour delta: none. All existing tests pass unchanged
(core 1085/1085, plugins 328 + 5 skipped). Strictly a refactor that
makes the upcoming `normalizeDocument` and `diffDocuments` public APIs
possible without duplicating logic across packages.

Other packages: lockstep version bump, no behavior change.
