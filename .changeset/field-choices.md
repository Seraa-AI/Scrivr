---
"@scrivr/core": patch
"@scrivr/docx": patch
---

A dropdown's choices are `{ id, label }` (`FieldChoice`, validated by `FieldChoiceSchema`): the id is what Word stores as `w:value`, the label what it shows as `w:displayText`, and both survive a round trip. `insertField` refuses choices that share an id. `SignerFieldDescriptor` carries a dropdown's `options`, so a signing host can ask for one. `DocxSdtInline.listItems` is now `DocxSdtListItem[]`, keeping both halves of a `w:listItem`. `@scrivr/core` now depends on `zod`.
