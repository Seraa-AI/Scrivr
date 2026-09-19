---
"@scrivr/docx": patch
---

Keep a DOCX's headers and footers when the import lands in an editor.

Importing is two steps, and the second one lost them. `importDocx` reconstructs
the header/footer policy from the section's references and returns it on
`doc.attrs`; putting that document into an editor replaced only the content, so
every attribute the import had settled — the chrome, the final section's
settings — was parsed correctly and then dropped. A file's headers survived
every step but the last.

`applyImportedDocument(editor, doc)` is now exported, and the
`importDocxFromFile` command uses it. Callers who apply an imported document
themselves should use it rather than replacing the content directly, which is
where the attributes go missing.
