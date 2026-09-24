---
"@scrivr/core": patch
---

A document waits for the faces it is written in before it is first shown.

Installing owned bytes is asynchronous and nothing held the first paint for
it, so a document was measured against whatever the host substitutes for a
family it does not have, then re-measured when the real faces landed —
re-breaking every line. Worse, the set became visible as it filled: faces
install one at a time and the resolver read the map live, so a line holding
regular and bold text could take the real face for one run and a substitute
for the other, placing its runs from two typefaces at once. That is what read
as jumbled rather than merely wrong-fonted.

Three changes:

- A set of faces is published in one go, and two passes asking for the same
  face share one install rather than repeating it.
- Font installation is part of becoming ready. `loadingState` reports
  `"syncing"` until the faces are in, and the renderer paints nothing in that
  state — on construction, and again when a collaborative document syncs,
  because the editor is usually built on an empty placeholder and the real
  document's faces are only knowable at sync.
- The wait is bounded at two seconds. A provider that never answers shows the
  document against what resolved, which is what it did before — a host's font
  problem must not become an editor that cannot paint. Faces arriving after
  that still repaint when they land, rather than waiting for an unrelated edit.

**Only before the document has ever been shown.** A face first needed later —
picking a weight the document has not used — installs in the background and
the layout refines, exactly as before. A live document is never taken away,
never put behind a loading state, and never has its layout thrown back to the
first chunk.

`"syncing"` therefore now has a second cause for editors that configure a font
provider. A consumer that renders collaboration copy for that state will show
it briefly while faces install, with collaboration switched off. The editor
container is still sized during the wait, so nothing shifts when the document
appears.
