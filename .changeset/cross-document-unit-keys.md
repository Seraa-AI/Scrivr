---
"@scrivr/core": patch
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

The key is SHA-256, added to `@scrivr/core` as `sha256Hex` — sync and
dependency-free, because `crypto.subtle` is async and Node's `crypto` is absent
in the browser, and an identity key computable on only one side of the wire is
not an identity key. The existing `fnv1aHex` stays where it belongs: it compares
a block against one prior value of itself, where 32 bits is ample. A corpus key
is compared against every key already held, so collisions follow the birthday
bound rather than luck — two fee clauses differing only in an amount collide
readily at 32 bits — and these documents arrive from counterparties, who are in
a position to aim for one.

It is still only a key. A hash cannot prove equality, so a corpus that acts on a
match — merging records, discarding an upload — confirms it by comparing
`unitAlignmentInput`, which is published for that purpose.

NFKC normalization is a deliberate loss of distinction, not just cleanup. It
folds the compatibility forms an importer introduces — ligatures, full-width
Latin, non-breaking spaces — and in doing so makes `m²` and `m2` the same text.
That is the right trade for matching a clause across formats and the wrong basis
for asserting two documents are byte-identical.

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
functions rather than restated, so the preimage and the digest cannot drift, and
both return named types — `UnitRichInput` and `SemanticPartRichInput` — so a
consumer reads `.spans` rather than asserting its way past the return type.
