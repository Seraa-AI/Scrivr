---
"@scrivr/core": patch
---

**The menu visibility defaults are exported, so a consumer can widen a rule
instead of replacing it**

`shouldShow` is all-or-nothing: passing one replaces the built-in rule rather
than extending it, and the built-in rule was not reachable. A consumer that
needs the bubble menu to stay open for one extra case — a capture form inside
the popover — had to re-implement "not empty, not a cell selection, has text"
from our source. That copy is correct only until this repo changes how cell
selection works, and then it diverges silently, in the consumer's build, with
nothing to catch it.

- **`@scrivr/core`** — `defaultBubbleMenuShouldShow` and
  `defaultFloatingMenuShouldShow` are exported, so widening reads as
  `shouldShow: (s) => capturing || defaultBubbleMenuShouldShow(s)` and keeps
  tracking the default.
- **`@scrivr/core`** — the `shouldShow` option documents that it replaces
  rather than extends, and names the default to compose with. The behaviour was
  never obvious from the type, which is how the copy happened.
