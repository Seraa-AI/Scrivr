---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

Sealed fields work at any zoom. `editor.getNodeRects(docPos)` (also on `IEditor`) gives a node's painted fragments in page units, each with its page — what to test a `PagePoint` against — and `FieldCompletion` uses it, so a press on a field opens it at 50% or 200% as at 100%. `"pagesInView"` reports the pages on screen at any zoom.
