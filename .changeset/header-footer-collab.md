---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

Collaborative headers & footers (Phase 5 of the header-footer plan).

**`@scrivr/core`** — `ExtensionManager` exposes `getDocAttrNames()` and
`getDocAttrOwners()`, sourced from the doc-attr ownership map already built
during schema construction. `IBaseEditor` grows `getDocAttrNames(): string[]`
so headless consumers (collab bindings, future audit tooling) can read the
declared-attr whitelist without touching schema internals. `BaseEditor`
implements the delegation, inherited by `Editor` and `ServerEditor`. Pure
additive surface.

**`@scrivr/plugins`** — `YBinding` now syncs `doc.attrs` across peers via a
sibling `Y.Map("prose_doc_attrs")` keyed by attr name with `DocAttrEnvelope`
values (`{ localSeq, value }`). Header/footer policy edits propagate between
peers, late joiners adopt the room's current policy on `markSynced`, and
the `Y.UndoManager` scope grows to cover the attrs map so Cmd-Z reverses a
policy change like any other document edit. The whitelist comes from
`editor.getDocAttrNames()` so only declared attrs cross the wire; undeclared
keys and malformed envelopes are silently dropped. Yjs remains authoritative
for conflict resolution — `localSeq` is a local dedup hint, not a tiebreaker.

`HeaderFooterRibbon` placement fix (it now sits above the header band rather
than overlapping the painted header content).

**`@scrivr/react`** — `HeaderFooterRibbon` + `useHeaderFooterRibbon` updated
to match the new ribbon-placement contract.

**`@scrivr/export`, `@scrivr/export-pdf`, `@scrivr/export-docx`,
`@scrivr/export-markdown`** — lockstep version bump only; no behavior change.
