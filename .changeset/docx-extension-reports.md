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
  - Highlight notes an unreadable colour written as yellow. Link notes a title it does not write.
  - Table notes a cell background it blends onto white because it is translucent, or does not write because it is not a colour.
  - SourcedBlock notes a source link too long for Word's 255-character tag.
- **Import.**
  - Underline notes a style other than single (`"double" underline imported as single`); the parser now keeps an underline's `w:val` so it can.
  - FontSize notes a size rounded to a whole pixel and drops one that is not a size.
  - Highlight notes a colour it cannot keep when the editor has one highlight colour, and a shading pattern drawn as its fill alone.
  - FontFamily notes a run whose East Asian or complex-script face differs from the one kept. It drops a theme font as `"theme font not resolved"` and an `rFonts` with no Latin face as `"no Latin font named"`, where both were `"handler returned nothing"` before.
  - Link drops a hyperlink with no usable target as `"no usable target"`.
  - Image drops one it cannot find as `"image part not found"`, or `"media option is drop"` under that option.
  - CodeBlock drops an inline object a code block cannot hold and notes the formatting it removes.
- **`report.dropped(kind, reason)` takes content back out of what was counted kept** when a handler leaves out something it was handed inside its item, so an image a code block discards is counted dropped, not kept.
