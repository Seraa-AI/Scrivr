---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
---

Fields are easier to read and to complete.

- **Who signs where:** a field is drawn in quiet ink, a dotted rule in its party's colour (`fieldRoleColor`, the same for a role everywhere) with an icon and its label standing on it. The PDF prints the same blank as a solid line. A field that holds text is as tall as the text around it, so its line keeps its height, as a Word content control does; signatures and initials keep their size on the baseline, as an inline image does.
- **While authoring:** an arrow pointer over a field, and a tag saying who fills a selected one. Backspace or Delete beside a field selects it first and the next press removes it. Extensions can set the pointer with `editor.addPointerCursor`, and `KeymapPriority.inlineObject` outranks every other binding.
- **While signing:** `FieldCompletion` draws the viewer's own empty fields solid in their colour with what to do on a badge ("Sign", "Date"), fades everyone else's, and tags them on hover. A hand pointer and a wash show what opens. Tab and Shift+Tab move between the viewer's fields and Enter opens one. A completed field reopens with its value (`onFieldRequest(field, current)`), and a completed value is plain text in the document's font, with no rule. `requestField` and `moveFieldFocus` let a host open a field from its own list or a "Next field" button. `accentColor` is optional and defaults to the party's colour.
- **No caret** in a read-only or sealed document; selecting still works.
