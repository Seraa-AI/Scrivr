---
"@scrivr/core": minor
"@scrivr/react": minor
"@scrivr/plugins": minor
"@scrivr/export": minor
---

feat(core): addDocAttrs() extension lane for doc-level attributes

Extensions can now contribute attributes to the `doc` node via a new `addDocAttrs()` Phase 1 hook:

```ts
const HeaderFooter = Extension.create({
  name: "headerFooter",
  addDocAttrs() {
    return { headerFooter: { default: null } };
  },
});
```

`ExtensionManager.buildSchema` merges contributions from every extension into the doc node spec. Two extensions contributing the same attr name is a collision and throws at schema-build time with an error naming both owners — extensions are expected to namespace their attr names to avoid collisions in practice.

Once declared, attrs are writable via ProseMirror's built-in `tr.setDocAttribute(name, value)`, which routes through `DocAttrStep` (jsonID `"docAttr"`, shipped in `prosemirror-transform` since 1.8.0). `@scrivr/core` now re-exports `DocAttrStep` as a convenience — extensions don't need to import from `prosemirror-transform` directly.

This is the foundation for PR 4's HeaderFooter extension and future footnotes / comments / page-settings extensions that need document-level metadata participating in undo/redo, history snapshots, and collaboration round-trips.
