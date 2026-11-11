---
"@scrivr/core": patch
"@scrivr/docx": patch
---

`createSnapshot` refuses with `unfilled-fields` while text the author fills still shows its prompt — a signer would agree to a blank — and with `unidentified-fields` for a signer field with no id or role, or another field's id, which nobody could complete. Typing at the edge of a prompt, or deleting part of it, replaces the whole prompt as in Word, so a prompt is never counted as filled; a line break inside a text field keeps it one field, in the editor and through DOCX. A field is now set in the face of the text around it, keeping its authored size, so an executed PDF prints its value in that face; values were dropped from PDFs exported with a font provider.
