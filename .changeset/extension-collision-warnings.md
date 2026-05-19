---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — extension authors now get a `console.warn` whenever one
extension silently overrides another's node, mark, keymap binding, command,
input handler, markdown parser token, or markdown serializer rule (per kind
or lane). Each warning names the previous and new contributor so accidental
typos that shadow built-ins surface immediately. Doc attrs and surface owners
remain `throw` on collision; the new warn lane covers everything else where
override is sometimes intentional but always worth knowing about.

Additionally:

- New baseline warning when an extension overrides ProseMirror's required
  `doc` or `text` node — points at `addDocAttrs()` as the supported path for
  doc-level data.
- New warning when more than one extension provides an initial document
  (e.g. `Collaboration` + `DefaultContent` stacking).
- `buildSchemaFromPhase1` no longer mutates its input contributions object.
- `Phase1SchemaContributions` now types `nodes` / `marks` as `NodeSpec` /
  `MarkSpec` instead of `object`, removing two `as` casts from the schema
  merge step.
- `buildPageConfig` reads `Extension.options` via runtime predicates
  (`isPageConfig`, `readStarterKitPagination`) instead of unchecked `as`
  casts.

Internal refactor: nodes, marks, keymap, commands, input handlers, markdown
parser tokens, markdown serializer rules, and doc-attrs all share one
`mergeContributions<T>()` helper with a `"warn"` / `"throw"` policy.

Other packages: lockstep version bump, no behavior change.
