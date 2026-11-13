---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
---

Fields are easier to read and to complete.

- **Who signs where:** a field is drawn in quiet ink, a dotted rule in its party's colour (`fieldRoleColor`, the same for a role everywhere) with an icon and its label standing on it. The PDF prints the same blank as a solid line. An author's text field still showing its prompt is drawn the same way, on a rule in the neutral colour of a field the author fills. A field that holds text fills its line as a word does, above the baseline and below (`text-bottom`), so its line keeps its height and its label and rule sit inside its own box, as a Word content control does; signatures and initials keep their size on the baseline, as an inline image does.
- **While authoring:** an arrow pointer over a field, and a tag saying who fills a selected one. Backspace or Delete beside a field selects it first and the next press removes it. Extensions can set the pointer with `editor.addPointerCursor`, and `KeymapPriority.inlineObject` outranks every other binding.
- **While signing:** `FieldCompletion` draws the viewer's own empty fields solid in their colour with what to do on a badge ("Sign", "Date"), fades everyone else's, and tags them on hover. A hand pointer and a wash show what opens. Tab and Shift+Tab move between the viewer's fields and Enter opens one. A completed field reopens with its value (`onFieldRequest(field, current)`), and a completed value is plain text in the document's font, with no rule. `requestField` and `moveFieldFocus` let a host open a field from its own list or a "Next field" button. `accentColor` is optional and defaults to the party's colour.
- **No caret** in a read-only or sealed document; selecting still works.
- **Fields fit what they hold:** a dropdown is as wide as its widest choice, and a field printed with a value (the executed PDF) is as wide as that value. A field takes the formatting of its run, so a bold field prints its value bold.
- **Host seal checks:** `createSnapshot` (and `snapshotFromYDoc`) take `checks: { before, after }`, the host's own `SealCheck`s (an approved template, a signing order), which refuse with `{ reason: "host", code, message }`.
- **Inline objects know their line:** `InlineStrategy.render` receives the baseline of the line it stands in, `measure` may return the `verticalAlign` of the node it measured, the strategy's own `verticalAlign` default is now honoured (it was documented but ignored), object rects carry their `baseline`, and a PDF inline atom's context carries `baselineY`.
- **The host's own look:** `Field.configure({ roleColors, paint, print })` and `FieldCompletion.configure({ roleColors, paint })`. `roleColors` sets a party's colour everywhere it is drawn. `paint` (screen) and `print` (PDF) draw a field the host's way, handed a `FieldDrawing` (box, baseline, kind, control, label, role, colour, theme, value), or a `SigningFieldDrawing` with `own`, `active`, `focused` and `pending` while signing; returning `false` falls back to Scrivr's look. `fieldRoleColor(role, overrides)` resolves a colour the same way.
