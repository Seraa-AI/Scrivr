---
"@scrivr/core": patch
"@scrivr/docx": patch
---

Fields now go through DOCX, Markdown and semantic export:

- **DOCX:** each field is a Word content control whose tag carries its id, kind, who fills it, and its role, so it comes back as the same field. A signature is Word's own signature line, which Word can sign. A checkbox is Word's checkbox, and text, initials and date fields are Word text and date controls.
- **Import:** inline content controls are now parsed rather than silently dropped. Their text is kept even when no extension claims them.
- **Markdown:** a field is written as its caption, where before `getMarkdown()` threw on a document containing fields.
- **Semantic export:** a block field is its own `fieldBlock` unit.
