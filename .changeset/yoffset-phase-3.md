---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

yOffset Phase 3: anchored-image height stops contributing to paragraph height. An image-only paragraph now reserves one default-font line of vertical space instead of inflating to the image's full height. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 3.

**@scrivr/core**

- **`BlockLayout`'s empty-node fallback widens from "renderable" to "non-zero".** Previously the ZWS injection only fired when no spans existed (or only `kind: "break"` spans). Now it also fires when every span is a zero-size object sentinel — i.e. a paragraph whose only content is one or more anchored images.
- **Sentinel preserved alongside ZWS.** When zero-size object sentinels are present, the ZWS is **appended** rather than substituted, so `getAnchoredObjectAnchors` still finds the image's docPos via `flow.lines[].spans[]`. Empty / break-only paragraphs keep the old substitute-with-ZWS behavior — no behavior change for those.
- **Result.** Image-only paragraph now has `block.height ≈ MOCK_LINE_HEIGHT` (default font line) rather than `block.height = imageHeight`. Inline images are untouched (their non-zero size keeps `hasNonZeroContent` true). Phase 1 invariant *"`paragraph.height === text.height` (no image contribution)"* is now true for the empty-anchor case too.
- **Tests.** `BlockLayout.test.ts` adds four Phase 3 tests: (1) image-only paragraph collapses to default font line, (2) sentinel is preserved on the line, (3) text + non-inline image keeps text line height, (4) inline image still inflates as before.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
