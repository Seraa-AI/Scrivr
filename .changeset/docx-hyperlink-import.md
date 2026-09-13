---
"@scrivr/core": patch
"@scrivr/docx": patch
---

Import hyperlinks from DOCX.

`Link` declared how a link is written to a .docx but not how one is read back,
so nothing claimed the hyperlink the parser produced. Every link in an imported
document arrived as ordinary text — a file round-tripped through Word came back
with all of its links flattened, and the only trace was a diagnostic no UI
shows.

`Link.addImports()` now claims it, resolving the relationship through the
part's own rels so a link in a header resolves against that header. A target
and a `w:anchor` are joined the way Word resolves them (`target#anchor`), an
anchor alone becomes a fragment, and a relationship that does not resolve falls
back to the anchor rather than losing both. Targets pass `safeUrl`: a .docx is
untrusted input and its rels are an ingestion path like paste. A link that
cannot be kept is reported rather than silently dropped.

**Behaviour change for `importDocx`.** An unclaimed hyperlink previously
produced an `unsupported-mark` diagnostic, and that code is in the fatal set —
so `{ unsupported: "throw" }` rejected *any* document containing a link.
Such documents now import. A link whose target is unusable still reports
`unsupported-mark`, so the policy keeps its meaning for real losses.

An extension that already registered its own `hyperlink` mark transform now
collides with the built-in and depends on registration order; an explicit
`importDocx(…, { overrides })` still takes precedence.
