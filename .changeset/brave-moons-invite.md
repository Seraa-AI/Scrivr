---
"@scrivr/core": patch
---

An inline node renders because an extension claims it, not because it carries
size attributes it does not use.

Layout decided whether an inline leaf was an object by looking for numeric
`width`/`height` attrs. A node with neither produced no span at all — no
position in the line, no entry in the character map, no warning. An extension
that declared an inline node and an `InlineStrategy` to measure and paint it
still got nothing, because the strategy was only consulted *after* that check
had already passed.

The workaround is in the repo: `pageNumber` declares `width: 7, height: 10`
purely to get through the gate, and `measure()` overwrites both immediately.
`InlineStrategy.measure`'s own documentation says it lets tokens size
themselves "instead of using fixed placeholders" — which the gate made
impossible.

A registered `InlineStrategy` is now enough on its own. Explicit size attrs
still work, so nothing that relied on them changes, and structural leaves are
unaffected — `hardBreak` is handled by name before this point.

A leaf that nothing claims is still skipped, because there is nothing honest to
lay out, but it now says so once by name rather than disappearing. That silence
is how this went unnoticed: the same lane broke once before and images "appeared
as blank cursors".
