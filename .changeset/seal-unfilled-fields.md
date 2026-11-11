---
"@scrivr/core": patch
---

`createSnapshot` refuses with `unfilled-fields` while text the author fills still shows its prompt — a signer would agree to a blank. A field is now set in the face of the text around it, keeping its authored size, so an executed PDF prints its value in that face; values were dropped from PDFs exported with a font provider.
