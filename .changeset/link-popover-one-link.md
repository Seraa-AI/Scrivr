---
"@scrivr/core": patch
---

The link popover, and the commands it calls, act on exactly the link the caret is in.

- **The popover's range is one link.** In a paragraph with two or more links, `LinkPopoverInfo.from`/`to` used to cover everything from the first link to the last. So saving an edited href (`@scrivr/react`'s `LinkPopover`, or `setLinkHref(info.from, info.to, …)`) relinked all of them, and the plain text between them, to the new href. Two adjacent links with different hrefs are now two links. A one-character link now opens the popover when the caret sits just past it.
- **`unsetLink` with a caret removes the link the caret is in**, as Word's Remove Hyperlink does. It used to remove over the empty selection, so the popover's Remove button did nothing.
- **`setLinkHref` keeps the link's `title`.** It used to reset it to `null`.
- A link is identified by its href. A run whose pieces differ only in other attrs, such as pending track-changes metadata, is one link.
