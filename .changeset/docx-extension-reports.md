---
"@scrivr/core": patch
"@scrivr/docx": patch
---

The built-in extensions report what their DOCX handlers could not carry across, so a report names the loss and the extension behind it.

- **Export.**
  - Paragraph and Heading report an indent, a first-line indent or a font they do not write.
  - Image reports alt text, a stacking order and an inline image's vertical alignment it does not write. It drops an image with no src (`"no src"`) or whose bytes could not be read (`"image bytes unavailable"`).
  - Color drops a colour DOCX cannot express (`"not a color DOCX can write"`) and a mark with no colour.
  - FontFamily drops a mark naming no font. FontSize notes a size that Word's half points round, and drops a mark with no size.
  - Highlight notes an unreadable colour written as yellow. Link notes a title it does not write, once per link.
  - Color, Highlight and Table note a translucent colour blended onto white, since DOCX has no alpha — though not the highlight's own colour, which the canvas draws the same way.
  - Table notes a cell background it blends onto white because it is translucent, or does not write because it is not a colour.
  - SourcedBlock notes a source link too long for Word's 255-character tag.
- **Import.**
  - Underline notes a style other than single (`"double" underline imported as single`) and an underline colour it does not keep; the parser now keeps an underline's `w:val` and `w:color` so it can.
  - FontSize notes a size rounded to a whole pixel and drops one that is not a size.
  - Highlight notes a colour it cannot keep when the editor has one highlight colour (not its own colour, so a round trip notes nothing), and a shading pattern drawn as its fill alone. Shading that sets no fill is no background, kept.
  - FontFamily notes a run that names several faces, of which the editor keeps one (`"one font kept of several named"`). It drops a theme font as `"theme font not resolved"` and an `rFonts` with no Latin face as `"no Latin font named"`, where both were `"handler returned nothing"` before.
  - Link drops a hyperlink with no usable target as `"no usable target"`, or `"the schema has no link mark"` — once per link, however many runs it spans.
  - Image drops one it cannot find as `"image part not found"`, one with no reference as `"no image reference"`, or `"media option is drop"` under that option.
  - A paragraph handler that leaves out formatting or inline objects it was handed — a code block keeping only text — has them moved from kept to dropped by the converter, as `LEFT_OUT` (exported). Formatting that carried nothing ("no formatting" values) and the paragraph style's own formatting are not charged.
  - Paragraph and Heading report a negative (hanging) indent they do not write.
- A smart tag's text is imported; it was dropped.
- A list's numbering format is read for each level, so a bullet level inside a numbered list stays bullets, and List reports a format it draws differently from Word's built-in style for that depth (`"upperRoman" numbering drawn as decimal`). `DocxBlock`'s list gains `level` and `format`.
- A page break inside an inline content control no longer fails the import: a line break stands in, and the page break is reported dropped.
- List import keeps every paragraph: a run whose first paragraph sits deeper than the ones after it lost those after it, silently — Scrivr's own export of an item started deeper with a nested list among them. A nested list is placed one level below its list, as the editor draws it.
- Headings Word numbers through their style — its built-in "1 Heading 1 / 1.1 Heading 2" — import as numbered list items, numbered as Word numbers them:
  - A paragraph's own `numId` and `ilvl` each win over its style's, and each is inherited through `basedOn` on its own; a paragraph with no style takes the default paragraph style's. `DocxParagraphAttrs.numbering` therefore carries either half alone.
  - A level nothing names is the one `numbering.xml` links to the style.
  - Numbering counts on across the paragraphs between items, and a level restarts under each new item of a shallower one, so sections separated by body text number 1, 2, 3 rather than 1, 1, 1.
  - Where Word draws no number, nothing is numbered: `numId` 0, a level formatted `none`, and a `numId` the document does not define — that last one reported as a dropped `w:numPr`.
