---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A PDF handler draws in layout pixels, without pdf-lib.

`ctx.draw` gains `text`, `line` and `rect` beside `lines`. Every coordinate is
layout pixels from the page's top-left and every colour is `Rgb`; the surface
converts to points and flips the axis, so a handler does neither. Out-of-range
channels and opacities are clamped rather than failing the export, and text is
reduced to what the resolved font can encode — a handler cannot do that itself,
since a font handle names a family rather than what the format made of it.

The built-in handlers, the table row renderer and the header/footer tokens all
draw through it now; none of them reference pdf-lib or carry their own copy of
the conversion. Drawn output is unchanged, except that two greys are now
exactly `#9ca3af` instead of hand-transcribed approximations of it.

**Breaking for a handler that draws.** `ctx.draw.image(image, rect)` becomes
`ctx.draw.image({ x, y, width, height, image: { src } })`, taking a `src` the
document embedded rather than a pdf-lib object. `ctx.draw.imagePlaceholder(box,
theme)` loses its second argument — the placeholder is painted from the
export's own palette now, so an anchored image and a block image on a page no
longer disagree about grey.

The spans, list markers and link annotations inside `draw.lines` still convert
inline; they hold resolved pdf-lib fonts and colours that the surface's
vocabulary deliberately cannot express.
