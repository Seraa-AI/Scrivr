---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/plugins` — fix heading/paragraph (and every other extension
command) inside header and footer editing surfaces.

Header/footer surfaces previously built their own restricted `Schema`
instance by copying the host editor's node specs into a fresh
`new Schema(...)`. `Heading.addKeymap()` and `addCommands()` capture
the host schema's `NodeType` at extension-resolve time and pass it to
`setBlockType()`. When the user pressed `Mod-Alt-1` (or invoked
`setHeading1` via a toolbar) inside a header, the keymap fired with a
host-schema `NodeType` against a surface state built from a *different*
`Schema` instance; ProseMirror's `canChangeType` rejected the mismatch
and the command silently returned `false`. The user saw nothing happen.

Surfaces now share `editor.schema` directly — same `Schema` instance,
same `NodeType` identity — so heading↔paragraph conversion, list
toggles, marks, and every other extension command work in headers and
footers exactly as they do in the body.

The "no tables, no page breaks in header/footer" restriction moves
from a rebuilt schema to a `filterTransaction` ProseMirror plugin on
the surface (`createBlockedNodeFilter`). The plugin walks the resulting
doc and rejects any transaction that introduces `table`, `tableRow`,
`tableCell`, or `pageBreak`. Same enforcement guarantee, applied at
the transaction layer instead of the schema layer, with one
mechanism covering paste, command insertions, and external dispatches.

**Public API surface:** `buildRestrictedSchema` is no longer exported
from `@scrivr/plugins` (the function is gone). The blocklist is
exposed as `HEADER_FOOTER_BLOCKED_NODES: ReadonlySet<string>` for
consumers that want to inspect or extend it.

Other packages: lockstep version bump, no behavior change.
