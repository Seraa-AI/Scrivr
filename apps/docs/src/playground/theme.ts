import type { EditorTheme } from "@scrivr/react";

// Canvas theme — every token is a CSS variable so the MutationObserver in the
// Editor auto-repaints when the `dark` class flips on <html>. The variables
// are defined in styles/app.css under `:root` (light) and `.dark` (dark).
export const PLAYGROUND_THEME: EditorTheme = {
  pageBg: "var(--scrivr-page-bg)",
  pageShadow: "none",
  defaultText: "var(--scrivr-text)",
  link: "var(--scrivr-link)",
  cursor: "var(--scrivr-cursor)",
  selectionFill: "var(--scrivr-selection)",
  imagePlaceholderBg: "var(--scrivr-img-placeholder-bg)",
  imagePlaceholderBorder: "var(--scrivr-img-placeholder-border)",
  imagePlaceholderText: "var(--scrivr-img-placeholder-text)",
  marker: "var(--scrivr-marker)",
  hrColor: "var(--scrivr-hr)",
  resizeHandle: "var(--scrivr-resize-handle)",
};
