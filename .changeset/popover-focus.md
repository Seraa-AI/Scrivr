---
"@scrivr/core": patch
---

A popover no longer closes when its own text box is clicked. The focus-outside check ran in the gap between the editor losing focus and the box gaining it, saw nothing focused, and hid the popover; it now waits for focus to land. Unsubscribing cancels a check still waiting, so `onHide` never reaches a popover that is gone.
