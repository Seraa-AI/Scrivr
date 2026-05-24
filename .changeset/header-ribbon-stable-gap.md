---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/plugins` — header/footer ribbon no longer pushes body content
down when activated.

Previously the layout reserved the slot's configured `margin` (default
12px) as the gap between header content and body. When the user clicked
into the header, the React ribbon (28px tall) needed more room than the
gap could fit — `policyWithLiveSurface` widened the margin to 28 on the
fly, recomputing the band's reserved height and shifting body content
down by ~16px. Clicking out reversed it. The shift was jarring.

Fix — always reserve at least ribbon-height for the gap at measure time,
inside `resolveChrome.measureSlot`. The body now sits at the same
position whether or not a surface is active; the ribbon simply appears
in space that was already there. The active-time clamp in
`policyWithLiveSurface` is gone — the function only updates the live
slot's content now.

Behavior delta — a header/footer with `margin < 28` is silently floored
to 28 at measure time (no API change; the stored value is preserved).
Documents that already used `margin >= 28` are unaffected. The slight
extra whitespace below tight headers is the cost of stable body
positioning.

Other packages: lockstep version bump, no behavior change.
