---
"@scrivr/core": patch
---

The link popover now reports only the link under the caret. In a paragraph with two links, it used to report a range from the first to the last of them, and the href of whichever started that range. So saving an edited href from the popover rewrote every link in the paragraph. Two adjacent links with different hrefs are now two links, not one.
