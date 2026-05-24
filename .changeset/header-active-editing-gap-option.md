---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/plugins` — `HeaderFooter` extension is now configurable with
`activeEditingGap` so consumers can match the gap reservation to the
height of their editing affordance.

```ts
HeaderFooter.configure({ activeEditingGap: 28 }) // default — matches React HeaderFooterRibbon
HeaderFooter.configure({ activeEditingGap: 40 }) // custom ribbon at a different height
HeaderFooter.configure({ activeEditingGap: 0 })  // headless / PDF / server — no UI to reserve for
```

The gap is the floor — `slot.margin` values smaller than this are
clamped at measure time so activating a surface does not push body
content down. Slot margins larger than the gap are honored as-is.

The previous fix already removed the active-time clamp from
`policyWithLiveSurface`; this change makes the floor explicit and
configurable instead of a hardcoded constant. Headless callers
(PDF export from `ServerEditor`, non-React UIs) can now opt out of
the 28px reservation that previously appeared in printed output.

Default unchanged for React consumers — the React `HeaderFooterRibbon`
remains 28px tall and the extension defaults to 28, so no migration
needed unless you're already passing custom config.

Other packages: lockstep version bump, no behavior change.
