---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Tables ship behind an opt-in flag. Phase 1's placeholder render is intentionally not in default `StarterKit` while the layout/render/export pipeline is filled in (Phases 2–4 of `docs/tables.md`). Apps consuming the released packages get unchanged behavior; tables are silent until explicitly enabled.

**Breaking-ish for early adopters:**

```ts
// Before — default-on:
new Editor({ extensions: [StarterKit] })

// After — opt-in:
new Editor({ extensions: [StarterKit.configure({ table: true })] })
```

**@scrivr/core**

- `StarterKitOptions.table` flips from `false?` (default-on, opt-out) to `true?` (default-off, opt-in). All five `if (opts.table !== false)` gates in `StarterKit` flip to `if (opts.table === true)` (nodes, commands, layout handlers, toolbar items, markdown serializer rules).
- `Table` extension and its types (`CellSubBlock`, `LayoutBlockKind === "tableRow"`) remain exported. Power users can continue composing `Table` directly without StarterKit:

  ```ts
  new Editor({ extensions: [StarterKit, Table] })
  ```
- 3 new regression tests in `Table.test.ts` lock in the contract:
  - default `StarterKit` does not include `table` / `tableRow` / `tableCell` / `tableHeader` in the schema,
  - default `StarterKit` does not expose `insertTable` / `deleteTable` commands,
  - `StarterKit.configure({ table: true })` registers the full schema.

**@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

- Lockstep version bump only — no API changes.
