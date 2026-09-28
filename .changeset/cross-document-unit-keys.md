---
"@scrivr/export-semantic": patch
---

A semantic unit can now be recognised in a document it did not come from.

`unit.id` addresses one block in one document, and `unitContentHash` answers
whether that block changed between two versions of the same document — it folds
in the breadcrumb for exactly that reason. Neither survives the clause being
seen somewhere else, which is the question a corpus asks on ingestion: is this
the indemnity I already hold, or a new one?

`unitContentKey` answers that one. It covers the unit's text alone, NFKC-
normalized with whitespace collapsed, so a clause that has been through a DOCX
round-trip or re-wrapped still keys the same. It is a companion to `unit.id`,
not a replacement: a corpus indexes by both — the instance id to find this block
again, the content key to find everywhere else the clause appears.

It is not a similarity measure. Two clauses differing by a word get unrelated
keys, by design; near-duplicate scoring is a separate question and a hash is the
wrong tool for it.

Grouping matters to the answer. A heading and its lede are deliberately one
unit, so a grouped unit carries its heading in `text`. Cross-document alignment
emits with `groupBlocks: false`, where a heading is its own unit and a clause is
keyed on the clause. `unitAlignmentInput` is exported alongside so a consumer
can see precisely what the key covers.

The rich lane now publishes its preimages too — `unitRichInput` and
`semanticPartRichInput`, the values `unitRichHash` and `semanticPartRichHash`
already hashed. A digest says a leaf changed; the preimage says which run did,
which is what a formatting-aware diff needs. Both are extracted from the hash
functions rather than restated, so the preimage and the digest cannot drift.
