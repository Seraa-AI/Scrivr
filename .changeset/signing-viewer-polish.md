---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

`FieldCompletion` paints values in the theme's text colour, so they read on a dark page; a ticked checkbox keeps its box; a completed field's outline no longer shows at its edges. `useScrivrEditor` accepts `sealed`. The screen and the executed PDF set a typed value at one size, shrunk to fit a long one into its box, and draw one tick: `fieldValueSizePx` and `checkboxTick` in `@scrivr/core`. If the host's `onFieldRequest` throws, the field stays open rather than stuck. `ReadingProgress` records reaching the end only once the whole document is laid out, and measures pages from below the scroll container's padding.
