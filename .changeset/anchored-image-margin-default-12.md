---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Default anchored-image margin (wrap-zone breathing room) bumped from `8px` to `12px` to match Word's `~0.13"` Square / Tight wrap default. The previous 8px default left text appearing flush against the image's visible pixels — 12px is closer to Word and visually clearly separates text from the image at typical reading sizes. Documents with an explicit `margin` attr are unaffected.

**@scrivr/core**

- `ANCHORED_OBJECT_MARGIN` constant: `8` → `12`.
- Image schema default in `Image.ts` extension and `model/schema.ts`: `8` → `12`.
- One affected test updated (`square-left: constrained lines …` — text now starts at `image.right + 12 = 212` instead of `208`).

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
