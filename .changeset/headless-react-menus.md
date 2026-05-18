---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

**⚠️ Visual behaviour change for `@scrivr/react` menu components — see migration note below.**

Make the React menu and popover components headless-friendly by removing baked-in visual inline styles, adding stable `data-*` state and part selectors, exposing per-part class name props for consumer styling, shipping an optional `@scrivr/react/styles.css` reference stylesheet that can be overridden by app CSS or Tailwind utilities, and exporting hooks for consumers who want to render fully custom UI.

**Migration:** the previous inline styles are gone. Consumers who relied on the default look must either (a) import `@scrivr/react/styles.css`, or (b) provide their own styles via the new per-part class name props / `data-*` selectors. This bump is **patch** in keeping with Scrivr's beta-only patch policy (`feedback_changeset_patch_only`); semver discipline begins at the future deliberate 1.0 → 2.0 graduation, not here.
