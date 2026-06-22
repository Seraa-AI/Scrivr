---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/plugins` — the Collaboration extension now connects on a headless
`ServerEditor`.

Provider/binding setup lived in `onViewReady`, which only fires in the browser
`Editor` — so a `ServerEditor` (no view) never created its Y binding or provider
and never joined the document. Setup moves to `onEditorReady`, which fires in
both environments; `YBinding` already depends only on `IBaseEditor`, so it works
unchanged. The two `setReady` calls (layout/paint suppression during Y.js sync)
are view-only and are now guarded — they no-op headless, where there is no paint
to suppress. `collaborationRegistry` is keyed by `IBaseEditor` so server-side
collab registers there too.

A side benefit: collaboration now wires up in `onEditorReady`, which always runs
before `CollaborationCursor`'s `onViewReady`, so the cursor extension can rely on
the provider already being registered.

Test: a `ServerEditor` configured with Collaboration registers its provider and
Y.Doc on construction (fails on the old `onViewReady` path).

Other packages: lockstep version bump, no behavior change.
