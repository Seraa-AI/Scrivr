---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/docx": patch
---

- `createSnapshot` checks every part of the document, not only its body. A prompt still showing or a suggestion still pending in a header or footer refuses the seal, and a signer field there refuses it with `fields-outside-body`, since the signing view completes fields in the body only.
- `createSnapshot` rejects, rather than refuses, when a host check throws or a header or footer holds content the editor's schema cannot read.
- `importDocx` returns `fieldValues`: what signers entered into fields' controls in Word, by field id, kept out of the document. A value takes the type its field's kind declares, and only a ticked box counts as an answer. A drawing in a signature control raises `field-drawing-not-imported` instead of vanishing.
- `FieldCompletion` takes `onFieldRequestError`, called when the host's request fails. Tab and Shift+Tab no longer cycle forever: past either end, focus goes on to the page's next control, and pressing elsewhere on the page lets focus go.
