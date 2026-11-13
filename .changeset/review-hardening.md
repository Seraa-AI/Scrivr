---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/docx": patch
---

Hardening from review:

- `createSnapshot` checks every part of the document, not only its body. A prompt still showing or a suggestion still pending in a header or footer refuses the seal, and a signer field there refuses it with `fields-outside-body`, since the signing view completes fields in the body only.
- `importDocx` returns `fieldValues`: what signers entered into fields' controls in Word, by field id, kept out of the document. A drawing in a signature control raises `field-drawing-not-imported` instead of vanishing.
- `FieldCompletion` takes `kinds`, so a host's own kinds draw and complete as their control in the signing view too, and `onFieldRequestError`, called when the host's request fails. Tab and Shift+Tab no longer cycle forever: past either end, focus goes on to the page's next control.
