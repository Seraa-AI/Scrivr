---
"@scrivr/core": patch
"@scrivr/ai": patch
"@scrivr/docx": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**The node-action contract is importable**

`addNodeActions()` shipped without its types reachable, so an extension could
contribute actions but could not name what it was contributing: a helper like
`function canCompare(ctx: NodeActionContext)` was unwriteable without
re-declaring the type, and a UI rendering `editor.getNodeActions()` had no name
for what it received.

- **`@scrivr/core`** — `NodeAction`, `NodeActionContribution`,
  `NodeActionContext` and `ResolvedNodeAction` are now exported.
- **`@scrivr/core`** — `NodeActionContext.node` used an inline
  `import("prosemirror-model").Node` type; now a top-level import, matching the
  rest of the file.
