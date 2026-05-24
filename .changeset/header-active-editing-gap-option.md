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
`activeEditingGap` so consumers can match the reserved gap to the
height of their editing affordance.

```ts
HeaderFooter.configure({ activeEditingGap: 28 }) // default — matches React HeaderFooterRibbon
HeaderFooter.configure({ activeEditingGap: 40 }) // custom ribbon at a different height
HeaderFooter.configure({ activeEditingGap: 0 })  // headless — no UI to reserve for
```

The value acts as a floor on `slot.margin`: smaller user-set margins
are clamped up at measure time so activating a surface does not push
body content down. Margins larger than the gap are honored as-is.

**Where the value lives.** Applied once at layout time inside
`resolveChrome.measureSlot` and baked into `slot.reservedHeight` +
`metrics.contentTop`. Every downstream consumer — canvas paint, PDF
chrome render, anything reading `editor.layout` — reads the same
baked value. The PDF render side is intentionally pure render and
has no knob of its own; configuring this option at editor
construction is the only place the gap is decided.

**Dual-use editor limitation.** A single browser `Editor` used for
both interactive editing and PDF export carries one value across
both modes — the same layout drives both. Configure for the editing
case (so the ribbon doesn't push content) and accept the same gap
in the exported PDF. Consumers that need a ribbon-friendly editor
*and* a tight printed PDF should run PDF export against a separate
`ServerEditor` constructed with `activeEditingGap: 0`, sharing the
same doc JSON. A future per-export override would require a
layout-pipeline primitive that accepts per-call chrome option
overrides — deferred until a concrete consumer requests it.

Default unchanged for React consumers — the `HeaderFooterRibbon`
remains 28px tall, the extension defaults to 28, and the React
hook offsets the ribbon by `-28`. All three locations are
cross-referenced in code comments so a custom ribbon at a different
height has clear instructions.

Other packages: lockstep version bump, no behavior change.
