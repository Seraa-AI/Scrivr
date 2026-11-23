---
"@scrivr/core": patch
"@scrivr/docx": patch
---

A heading can be a list item, as in Word: the bullet and numbered-list commands on a heading make it a list item that stays a heading, where before they silently did nothing. A list item may now start with any block in the `listItemLead` content group, which Paragraph and Heading join; DOCX export numbers a heading in a list and import brings it back as one. A new list item still starts with a paragraph, whatever order the extensions are registered in.
