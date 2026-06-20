---
---

Test-only: make the `LineBreaker` single-line width assertion tolerant of
inter-word kerning differences between host fonts. The previous 0.005px
`toBeCloseTo` precision passed only on the serif face the old CI runner image
resolved; after GitHub's `ubuntu-latest` font set drifted, the summed-per-word
line width diverged from the whole-string measurement by ~0.3px and failed.
No production code change; no version bump.
