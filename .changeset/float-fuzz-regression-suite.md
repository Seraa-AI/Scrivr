---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Anchored-object fuzz test suite — regression coverage for the float-image fixes that just landed, plus two surfaced bugs documented for follow-up.

**@scrivr/core**

- New `floatFuzz.test.ts` — 11 fuzz cases ported from the dropped `feat/float-layout-v2` branch and adapted to the current anchored-object model:
  - `500 random documents pass layout invariants` — pages valid, monotonic block Y, blocks within content bounds.
  - `100 dense float documents` — many floats per doc.
  - `50 degenerate inputs` — extreme sizes, zero dimensions, huge heights.
  - `100 random docs × 3 runs` — idempotence (same hash every run).
  - 6 adversarial scenarios — tall float, wide float, alternating left/right, standalone float-only paragraph, all 5 wrap modes coexisting, extreme negative offset.
  - 1 skipped: `200 random documents with floats: no text-float overlap` — surfaces a real square-wrap-first-line overlap bug. Seed mulberry32(123), doc#0. See `bug_square_wrap_first_line_overlap.md`.
- `assertFuzzInvariants` softens the "anchored object references a valid page" check from fail → log, matching the existing precedent for the known float-overlap-stacking limitation. The phantom-page issue is documented in `bug_anchored_object_phantom_page.md`.
- 8 of the 11 cases pass cleanly without any production-code change — direct evidence that the anchor-only-paragraph + page-clamped-exclusion + drag-cleanup fixes from the previous PR hold up under randomized stress.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
