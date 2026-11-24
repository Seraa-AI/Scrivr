---
"@scrivr/ai": patch
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/html": patch
"@scrivr/react": patch
---

Dependency updates, including the ones that fix known security advisories. Runtime majors: `markdown-it` 15 in `@scrivr/core`, `fast-xml-parser` 5 in `@scrivr/docx` and `happy-dom` 21 in `@scrivr/html`.

Importing a Word file keeps text that looks like a number as it was written. `007` came in as `7`, `1.50` as `1.5` and `1.00.01` as `1001`. Numeric character references such as `&#8217;` are now read as the character they stand for.

**Breaking (types):** `MarkdownToken.attrGet()` returns `string | number | null`. It already returned numbers for some attributes, such as a list's `start`.
