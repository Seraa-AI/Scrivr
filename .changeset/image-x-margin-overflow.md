---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Anchored images can now extend horizontally into the left or right page margins (Word-aligned). Vertical clamp remains at content bounds — top/bottom margins are reserved for headers and footers, so images cannot extend into them. This narrows a divergence from Word's behaviour; Google Docs allows broader margin overflow including footer/off-page drops, which we explicitly do not adopt.

**@scrivr/core**

- **`resolveImageX` accepts `pageWidth` and applies a different clamp per `xAlign`.** Named alignments (`left` / `center` / `right`) still snap to content bounds — the typography convention and Word's default "Margin" horizontal anchor. `xAlign: "custom"` (the user-positioned result of a drag) clamps to page bounds: `[0, pageWidth - imageWidth]`. The image can therefore hang into the left or right margin but cannot escape the page.
- **`PointerController.resolveDragTargetX` clamps the dragged image to page bounds** instead of content bounds, so live drag feedback matches the new commit behaviour.
- **Vertical `yOffset` clamp is unchanged** — painted top stays in `[pageStart, pageStart + contentHeight - height]`. Top/bottom margins are reserved for headers/footers.
- **Tests.** Two new `resolveImageX` cases cover left-margin and right-margin overflow; two existing custom-clamp cases updated to assert page-edge clamping. The "Step 3 — clamp-no-move" drag test is reframed around the page-left edge instead of the content-left edge.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
