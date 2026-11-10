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
- `collectFontRequests` and `prepareDocumentFonts` take the editor's
  `fontModifiers` and `fontConfig`, so a heading's text and a marked run are
  installed before first paint in the face they are drawn in.
  `IBaseEditor.getFontModifiers()` and `getBlockStyles()` are new;
  `applyPageFont` is exported.
- A `fontSize` mark that is not a finite size of at least 1px, or a
  `fontFamily` mark with an empty family, leaves the run in its block's font.
- A heading `level` stored as text ("2") is styled and drawn as that level.
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
  `prepareDocumentFonts(doc, provider, { fontModifiers?, fontConfig?, constraints? })`.
- `chromeFontConfig` (plugins, internal) is replaced by `chromeFontConfigOf`,
  and `ResolvedHeaderFooter` carries the band's `fontConfig`.
