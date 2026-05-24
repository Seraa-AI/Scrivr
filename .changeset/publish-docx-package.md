---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/docx` — first public release. Dropped `private: true`, aligned
version (`0.0.6` → `1.0.10`) with the lockstep version of the other
`@scrivr/*` packages, and added the missing publish metadata (author,
repository.directory, homepage, bugs, keywords, publishConfig). The
package now joins the changeset `fixed` group so future releases keep
all `@scrivr/*` packages in lockstep.

Why now: the DOCX round-trip (export PR #92 + import PR #94) shipped two
weeks ago and the demo has been exercising it. The package is ready to
ship to npm; the previous independent `0.0.x` versioning track and
`private: true` flag were holdovers from when only the skeleton existed.

No code or behavior changes — purely packaging metadata.

Other packages: lockstep version bump, no behavior change.
