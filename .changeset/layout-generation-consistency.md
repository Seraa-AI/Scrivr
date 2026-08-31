---
"@scrivr/core": patch
"@scrivr/ai": patch
"@scrivr/docx": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**Geometry knows which layout it describes, and publication cannot hand out a
mixed one**

Coordinates only mean something next to the pixels they were computed for. The
`CharacterMap` is rebuilt on every layout pass while the canvas beneath it keeps
whatever paint last landed, and nothing tied the two together — so a caret could
be placed from one layout onto a canvas painted from another, landing where the
text used to be.

The dispatch path could hand out that mismatch directly. Applying a transaction
notified subscribers *before* marking the layout stale, so anything woken by an
edit read the new document alongside the previous layout. That pair is not
detectably wrong from the outside: the charmap's generation matches the stale
layout it came from, so the geometry looks coherent while describing text that
has already moved.

- **`@scrivr/core`** — `CharacterMap` carries the layout version that populated
  it, stamped in the one function every layout assignment routes through and
  reset when the map is cleared. The overlay refuses to draw when that
  generation disagrees with the version the tile actually painted. An active
  surface is exempt, since its charmap is populated by its own paint hook with
  no layout version behind it.
- **`@scrivr/core`** — the view dispatch marks the layout stale before applying
  the transaction, so every `update` handler and subscriber observes a new
  document together with a layout that knows it is out of date. Reading
  `editor.layout` from a handler now recomputes rather than returning the
  previous pass.
