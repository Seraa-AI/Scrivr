---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — new `addPageConfig?(): PageConfig | undefined` extension
lane. Extensions can now contribute page dimensions, margins, and the
pageless toggle through the same first-class hook pattern used for nodes,
marks, page chrome, etc. `ExtensionManager.buildPageConfig()` resolves the
config by iterating the lane rather than looking extensions up by name —
the manager no longer hardcodes `"pagination"` or `"starterKit"`.

Behavior changes:

- `Pagination` extension now implements `addPageConfig()` returning its
  configured `PageConfig` options.
- `StarterKit` implements `addPageConfig()` reading its nested
  `pagination` option. Returns `undefined` when unset (so a downstream
  `Pagination.configure(...)` wins cleanly), the partial-merged config
  when set to an object, and `undefined` again when set to `false`.
- Multi-provider warning fires when two extensions contribute non-undefined
  page configs — same pattern as the initial-doc lane.
- The two `Extension.options` runtime predicates (`isPageConfig`,
  `readStarterKitPagination`) that existed to dodge `as` casts on
  `unknown` option lookups are gone — the typed lane removes the need.

The `[StarterKit, Pagination.configure(usLetter)]` user pattern continues
to resolve to `usLetter`. Bare `[StarterKit]` continues to render at
`defaultPageConfig` via Editor's existing fallback chain.

Future: when page config moves to `doc.attrs.pageSettings` (see
`project_page_config_to_docattrs` memory — collaborative page settings,
ruler-driven margin drags), the same `addPageConfig` lane stays in place
and the extension just sources from `state.doc.attrs.pageSettings`
instead of `this.options`. No manager-side rewiring needed.

Other packages: lockstep version bump, no behavior change.
