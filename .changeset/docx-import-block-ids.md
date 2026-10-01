---
"@scrivr/docx": patch
---

`importDocx` returns a doc whose blocks have ids.

`UniqueId` fires on transactions, and the importer never dispatches one — so
every block came back `nodeId: null`, 618 of them in one contract. The
docstring's `editor.setContent(doc.toJSON())` would have put the doc through a
transaction and minted them, but a server caller that wants the parsed node and
its diagnostics has no reason to guess the ids depend on doing so.

The failure is silent and deferred: id-less content stores fine, and the ids get
minted later, per load, wherever the doc is next materialised — so two reads of
one unchanged document disagree about what its blocks are called, and a review
of an imported contract reports stale sections against a document nothing has
changed.

Assignment is conditioned on the editor carrying `UniqueId` rather than on a new
option. The promise is that an import holds what an editor session would, and a
session built without `UniqueId` mints no ids when a person types into it
either. It runs after the `onImportComplete` hooks, so a contribution's own
blocks are addressable too.
