---
"@scrivr/core": patch
---

New `Field` extension (not in StarterKit). It adds a `field` inline atom: a signer field (signature, initials, date, text or checkbox) that the document never holds a value for, or an author's checkbox. Commands are `insertField` and `toggleFieldChecked`; `listSignerFields(doc)` lists the fields by role. Fields are painted on canvas and in the PDF. A selected field is not typed or pasted over, as a locked Word content control is not; Delete and Backspace still remove it. Inline atoms that declare `nodeId` now get unique ids like blocks do, so a pasted field, or image, gets its own id.
