---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — central URL allow-list at the document boundary. PR 2
of the pre-1.x security baseline (`SECURITY.md` shipped in PR 1).

Adds `safeUrl(value)` in `@scrivr/core/model`. Returns the trimmed input
when the value is safe to store, `null` when it isn't. Allow-list:
`http`, `https`, `mailto`, `tel`, fragment-only (`#anchor`), and
relative URLs. Everything else — `javascript:`, `data:`, `vbscript:`,
`file:`, unknown custom schemes — returns `null`. Strips ASCII control
characters before validating so the classic `"java\x00script:"`
obfuscation can't slip past a naive prefix check. Trims whitespace.
Case-insensitive scheme match per RFC 3986. Defensive against non-string
input so callers reading from `unknown`-typed sources (collab apply,
parseDOM attribute getters) can pass values through without their own
type guard.

Wired at every URL ingestion point in `Link` and `Image`:

- `Link` parseDOM — `<a href="javascript:...">click</a>` → mark dropped,
  text preserved (returning `false` from `getAttrs` is the canonical
  "drop this match" signal)
- `Link.setLink` command — prompt validated; unsafe input is a no-op
- `Link.setLinkHref` command — returns `false` on unsafe href; safe
  href stored normalised
- `Image` parseDOM — `<img src="javascript:...">` → node dropped entirely
- `Image.insertImage` command — prompt validated; unsafe input is a no-op

**JSON-load gate** — addresses the codex-flagged gap that parseDOM-only
validation leaves: `schema.nodeFromJSON` bypasses parseDOM entirely, so
a saved doc on disk with `link.attrs.href = "javascript:..."` would
round-trip unchanged.

New `sanitizeDocUrls(doc, schema)` walks a constructed PM doc and
applies the same allow-list to URL-bearing attrs. Image with unsafe
`src` → node dropped. Link mark with unsafe `href` → mark stripped,
text and co-occurring marks preserved. Cheap idempotent fast-path: a
clean doc returns the same `Node` reference, no allocation.

Wired at both raw-JSON ingestion sites:

- `BaseEditor` constructor — covers `content: json`, `content: "markdown"`,
  and extension-supplied `addInitialDoc()` (like `DefaultContent`) in
  one place
- `ServerEditor.setContent(json)` — runtime doc replacement

**Out of scope** (deliberate, separate PRs):

- **Collab Y→PM apply** — `yXmlFragmentToProseMirrorRootNode` bypasses
  both parseDOM and constructor init. Adversarial-peer trust is already
  documented in `SECURITY.md` as an app-layer concern (auth, validation,
  potentially E2EE). A post-apply walker is a separate design.
- **Hand-rolled raw-node transactions** (`editor.applyTransaction(tr.replaceWith(0, 5, rawNode))`)
  — covered if the node came through commands, not if hand-rolled. A
  doc-wide transaction filter would catch it but trades for per-keystroke
  overhead. Defer.

**Bonus cleanup** (the user's no-`as` rule extends here):

- New `getNodeAttrs<K>` / `getMarkAttrs<K>` typed accessors in
  `@scrivr/core/model`. Look up `NodeAttributes[K]` / `MarkAttributes[K]`
  augmentations to give extension authors typed `attrs.src` /
  `attrs.href` access. Single `as` lives inside the helper behind a
  runtime kind check — no scattered casts at usage sites.
- Augmented `NodeAttributes.image` (existing `MarkAttributes.link` was
  already in place from a prior PR).
- Removed 4 scattered `as` casts from `Link.ts` and `Image.ts`. Zero
  type assertions remain in either file.

**Tests** (43 new):

- 25 fuzz tests on `safeUrl` covering all the agreed obfuscation
  scenarios from the security baseline plan
- 11 tests on `sanitizeDocUrls` covering helper behaviour + ServerEditor
  constructor + setContent integration
- 7 integration tests on `Link` covering parseDOM rejection and command
  rejection

All 12 monorepo typecheck tasks pass. All 11 test tasks pass.

Other packages: lockstep version bump, no behavior change.
