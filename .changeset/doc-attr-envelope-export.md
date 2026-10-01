---
"@scrivr/plugins": patch
---

`isDocAttrEnvelope` and `DocAttrEnvelope` reach the package surface.

The doc-attrs release notes said both were exported. Only `DOC_ATTRS_MAP_NAME`
was: the guard was exported from its own module and never re-exported from the
barrel, so it appeared in `dist/index.d.ts` exactly once, inside a comment.

`seedDocAttrs`/`readDocAttrs` remain the answer for moving attrs across a
storage boundary — a caller should not have to know the values are wrapped. The
guard is for a host that reads the map directly and has to agree with the live
sync about which envelopes are real. The type ships with it: a predicate that
narrows to a name the caller cannot import vouches for a value it cannot
annotate.
