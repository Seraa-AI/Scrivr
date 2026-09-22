---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/plugins": patch
---

Every block in a PDF is drawn by the extension that defines it.

Five paths reached paint without asking who owned the node: the body loop,
header and footer bands, table cell children, inline atoms, and anchored
objects. Each did its own thing — chrome and table cells drew text directly, so
any block type that is not text rendered on the canvas and vanished from the
file (a horizontal rule in a header, for one); inline spans branched on the name
`"image"` to redraw what the image handler already knew how to draw; and every
anchored object was assumed to be an image, so anything else anchored painted a
grey placeholder rather than whatever its own handler draws.

They now share one dispatch, `ctx.blocks(blocks)`. The pipeline still owns
traversal, placement and ordering; the extension owns what its node looks like.
A node type with no PDF handler is also reported the same way wherever it
appears — an inline atom used to be dropped in silence while the same node
warned as a block.

`PdfContext` gains a required `blocks` member. By the versioning policy in
docs/export-extensibility.md a mandatory field is a breaking change to the
handler API; it ships as a patch while these packages are in beta. Anyone who
declares their own structural `PdfContext` shape has to add it.

No handler moved, so the op-log is unchanged — which is the point: this is
routing, and the baselines prove it changed nothing that was already working.
