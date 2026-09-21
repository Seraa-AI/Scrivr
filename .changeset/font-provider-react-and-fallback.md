---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/react": patch
---

Font fallback keeps the weight, and the React adapter can be given a provider

`useScrivrEditor` now accepts `fonts`, and `@scrivr/react` re-exports
`DefaultFontProvider` and the font types — the adapter previously had no way to
supply an inventory, so every React app fell back to asking the browser.

Falling back to the default now picks the nearest face in the default's
*family* rather than the single default resource. A document naming a family
nobody owns still means bold where it says bold; answering every weight with
the regular face rendered a contract's headings in body text.

A CSS font-family list is no longer treated as one family name:
`"Arial, sans-serif"` asked the provider for that literal string and matched
nothing registered as `Arial`. The rest of the list is the host's fallback
chain, which is the decision a provider replaces.

Font substitutions are reported once per face rather than once per face and
size — a ten-page contract reported thirteen shortfalls for five faces.
