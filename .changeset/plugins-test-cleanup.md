---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/plugins`: widen `YBinding`'s `editor` parameter from `IEditor` to
`IBaseEditor`. The binding only uses base-editor APIs (`getState`,
`subscribe`, `_applyTransaction`), so accepting the narrower interface
covers both browser `Editor` and headless `ServerEditor`. Backwards
compatible — existing `IEditor` callers still satisfy `IBaseEditor`.

No runtime / API change to other packages — bumps included for lockstep
versioning.
