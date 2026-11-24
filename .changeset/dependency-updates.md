---
"@scrivr/ai": patch
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/html": patch
"@scrivr/react": patch
---

Dependency updates, including the ones that fix known security advisories. `@scrivr/docx` moves to `fast-xml-parser` 5 and `@scrivr/html` to `happy-dom` 21. `@scrivr/core` no longer depends on `@floating-ui/dom`, which it did not use.

Importing a Word file keeps text that looks like a number as it was written: `007` came in as `7` and `1.50` as `1.5`. Numeric character references such as `&#8217;` are read as the character they stand for, and an error for a file that cannot be read no longer quotes the file's text. A file whose XML ends early is refused instead of losing the rest. Exporting leaves out characters that XML does not allow, which made the file unreadable.

`@scrivr/core` pins two ProseMirror packages whose newest releases change behavior. With `prosemirror-history` 1.5.2, redoing an alignment or heading moved the selection to the next paragraph. With `prosemirror-markdown` 1.14, bold text that also has a color, font, link or underline and ends in a space was written as literal asterisks. A new install of an earlier Scrivr release could already pick these up. Import ProseMirror from `@scrivr/core/pm`: a second copy of `prosemirror-history` in your app does not see the editor's history.

Markdown export writes the space at the end of struck text outside the `~~`, so it is read back as struck text.
