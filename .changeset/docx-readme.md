---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/docx` — replace the placeholder README with a proper one. Covers
installation, in-editor usage via the `DocxImport` / `DocxExport` extensions,
server-side usage via `importDocx` / `exportDocx` with `ServerEditor`, the
shared option dials (`unsupported`, `fidelity`, `media`), and how custom
extensions contribute their own DOCX handlers via `addImports` / `addExports`.

No code changes — the placeholder text was a leftover from when the package
was a type-only skeleton.

Other packages: lockstep version bump, no behavior change.
