---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — lift ingestion-time normalization from `ServerEditor`
up to `BaseEditor` so the browser `Editor` benefits too.

Previously `new Editor({ content: jsonFromAi })` only got URL safety
on the initial doc; node-ID assignment and table repair waited for the
first transaction to fire the `UniqueId` and `tableIntegrityPlugin`.
A consumer who constructed an editor and immediately serialised
without typing anything saw an un-normalized snapshot.

Now `BaseEditor`'s constructor routes the initial doc through
`normalizeDocument` — JSON, markdown, or extension-supplied default —
so every initial state is URL-safe, table-repaired, and fully
ID-stamped before the first transaction. `editor.lastNormalizeResult`
exposes the same `{ doc, warnings, fingerprint, changed }` shape that
`ServerEditor.setContent` already populated.

`normalizeDocument(input, options)` also now accepts a parsed
ProseMirror `Node` (not just JSON), so callers that already have a
Node — including `BaseEditor`'s own constructor after the markdown
parse — skip the wasted JSON round-trip.

Behaviour delta — the browser `Editor` now also stamps node IDs and
repairs tables on initial load. Symmetric with the server side; the
in-editor plugins (`UniqueId`, `tableIntegrityPlugin`) still run on
subsequent transactions and find no work to do because the constructor
already handled it. Full suite green (core 1105/1105, plugins 328 + 5
skipped, typecheck 13/13).

Other packages: lockstep version bump, no behavior change.
