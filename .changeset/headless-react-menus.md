---
"@scrivr/core": major
"@scrivr/react": major
"@scrivr/plugins": major
"@scrivr/export-pdf": major
"@scrivr/export-markdown": major
---

Make the React menu and popover components headless-friendly by removing baked-in visual inline styles, adding stable `data-*` state and part selectors, exposing per-part class name props for consumer styling, shipping an optional `@scrivr/react/styles.css` reference stylesheet that can be overridden by app CSS or Tailwind utilities, and exporting hooks for consumers who want to render fully custom UI.
