---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — regression coverage for `PasteTransformer` and the
markdown ingestion path against real-world hostile inputs. No
functional changes; documents what the existing pipeline already does.

`PasteTransformer.test.ts` gains five new describe-blocks asserting
the cleaning contract on every output doc:

- **drops script and style elements** — `<script>`, `<style>`, nested
  scripts inside divs
- **strips event-handler attributes** — `onerror`, `onclick`,
  `onmouseover`, body-level `onload`
- **rejects forbidden URL schemes** — `javascript:`, `data:text/html`,
  `vbscript:`, `file:`, plus obfuscation variants (mixed case,
  whitespace prefix, HTML-entity-encoded scheme)
- **ignores embedded objects** — `iframe`, `object`, `embed`, `form`
- **SVG content model** — `<svg><script>`, `<svg onload>`

Plus a deeply-nested-wrappers case proving the cleaning walks through
any depth.

`parseMarkdown.test.ts` (new file) covers the markdown ingestion path
the constructor uses when given `content: "..."`. With
`MarkdownIt({ html: false })` raw HTML in markdown source survives as
literal text — safe in every render target the framework supports
(canvas paints glyphs, exports use textContent / structured writers,
DOM renderers are required to use textContent per the security model).
The structural and URL invariants are asserted; the literal-text
behavior is documented as intentional.

Each describe-block reads as a normal regression test for how the
component behaves under hostile input — not as a labelled "security
suite" that would advertise the threat surface or frame defenses as
separable from the features they protect.

Comment cleanup along the way: removed temporal references from
`Document.ts` ("hardBreak lives in its own HardBreak extension as of
the extraction PR") and `HardBreak.ts` ("Previously bundled inside
the Document extension. Extracted so it...") that coupled the code
to specific PR work.

Other packages: lockstep version bump, no behavior change.
