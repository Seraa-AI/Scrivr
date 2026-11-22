---
"@scrivr/core": patch
---

A heading can be a list item, as in Word: the bullet and numbered-list commands on a heading make it a list item that stays a heading, where before they silently did nothing. A list item may now start with any block in the `listItemLead` content group, which Paragraph and Heading join; DOCX export numbers a heading in a list and import brings it back as one; a heading Word numbers through its style rather than its own `numPr` still imports as a plain heading. A new list item still starts with a paragraph, whatever order the extensions are registered in.
