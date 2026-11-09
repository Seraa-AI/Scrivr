---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/docx": patch
---

Marks change the font only through the font modifiers their extensions
declare (`addFontModifiers`), and plain-text paste builds the schema's default
block. Bold, italic, font size and font family look, measure and report as
before.

- A mark from any extension that declares a font modifier is measured, asked
  for before layout, and reported by `getActiveFontFamily` and
  `getActiveFontSize` in the font it declares.
- `collectFontRequests` takes `fontModifiers`; `IBaseEditor.getFontModifiers()`
  is new.
- Headers and footers are styled by the editor's block styles, with a
  paragraph's spacing dropped as before, so any block an extension styles
  looks the same in a header as in the body.
- Plain-text paste and pasted-block merging use the schema's default
  textblock, `paragraph` in every built-in schema.

**Breaking:**

- `resolveFont` no longer has a built-in fallback for `bold`, `italic`,
  `fontSize` and `fontFamily`: pass the editor's font modifiers.
- `defaultFontConfig` holds only `paragraph`; heading styles come from
  `Heading.addBlockStyles()`.
- `prepareDocumentFonts(doc, provider, constraints?)` is now
  `prepareDocumentFonts(doc, provider, { fontModifiers?, constraints? })`.
- `chromeFontConfig` (plugins, internal) is replaced by `chromeFontConfigOf`,
  and `ResolvedHeaderFooter` carries the band's `fontConfig`.
