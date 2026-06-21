---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — an anchored object after an explicit page break now stays on
the same page as its anchor instead of being left behind on the previous page.

Root cause: a `pageBreak` flow has height 0, so Stage 2 (`assignGlobalY`) gave
it no contribution to the continuous `globalY`. Stage 3 then derived the
anchor's page from that continuous coordinate — which still pointed at the
pre-break page — so an image anchored after the break was placed there, while
Stage 4 force-advanced the anchor text to the next page. The float and its
anchor split across pages (the "behind"/"front"/"square" image stranded on the
prior page, with text wrapping the wrong page).

Fix at the Stage 2/3 seam: `assignGlobalY` (and `restampGlobalYFrom`, used by
the anchor-push and wrap-zone reflow) now advance `globalY` to the next page's
content top when they cross a forced page break. With `globalY` reflecting the
real vertical position, Stage 3's page derivation, anchor-push, and exclusion
zones all agree with Stage 4's pagination — the model invariant ("no content
after an anchored object renders on an earlier page than the object") holds by
construction for the explicit-page-break case.

Regression test: a square float anchored after a `pageBreak` lands on page 2
with its anchor (fails before, passes now).

Remaining known limitation: a float can still desync from its anchor when the
*preceding paragraph* splits across a natural page boundary (no explicit
break) — a separate Stage 3/Stage 4 case tracked for later.

Other packages: lockstep version bump, no behavior change.
