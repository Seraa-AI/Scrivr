/**
 * Editor theming — colors that paint on the canvas surface.
 *
 * Two types: `EditorTheme` (input — accepts CSS color strings, including
 * `var(--token)` references) and `ResolvedTheme` (output — literal colors
 * only, what render contexts actually consume).
 *
 * Browser path: `EditorTheme` → `resolveTheme(theme, themeRoot)` → `ResolvedTheme`
 * Server path: PDF export accepts `Partial<ResolvedTheme>` directly (no DOM, no
 * resolver). PDF defaults are independent of the canvas theme — print stays
 * print-ready even when the canvas is themed dark.
 *
 * Per-extension theming: extensions that paint their own colors (CodeBlock
 * bg/border, custom block strategies) declare their theme keys via the
 * extension's `theme` option and read from the merged `ResolvedTheme`
 * namespaced by extension name (e.g. `theme.codeBlock.bg`).
 */

/**
 * Top-level theme tokens covering cross-cutting paint surfaces (page, text,
 * cursor, selection, image placeholders, list markers, horizontal rules,
 * resize handles, links).
 *
 * Each token accepts any CSS color string. Strings containing `var(--...)`
 * are resolved at paint time via the editor's `themeRoot`.
 *
 * Per-instance precedence rule: a constructor-set theme overrides any
 * `addInitialTheme` extension contribution. User-applied `color` marks
 * override `defaultText` at the span level (theme is the *default* fill,
 * not an override).
 */
export interface EditorTheme {
  // Page surface
  /** Page background fill. */
  pageBg?: string;
  /** Page wrapper shadow — full CSS box-shadow value (e.g. "0 1px 3px rgba(0,0,0,0.1)"). */
  pageShadow?: string;

  // Text
  /** Default text color when no `color` mark is applied. */
  defaultText?: string;
  /** Link mark color and underline color. */
  link?: string;

  // Selection / cursor
  /** Caret color. */
  cursor?: string;
  /** Selection rectangle fill (use rgba for transparency). */
  selectionFill?: string;

  // Image placeholders (loading / error)
  /** Image placeholder background fill. */
  imagePlaceholderBg?: string;
  /** Image placeholder border stroke. */
  imagePlaceholderBorder?: string;
  /** Image placeholder text (alt label). */
  imagePlaceholderText?: string;

  // Block / list / horizontal rule
  /** Bullet/number color in lists. */
  listMarker?: string;
  /** Horizontal rule stroke color. */
  hrColor?: string;

  // Image resize / drag handles
  /** Image resize handle stroke + fill (visible during image edit). */
  resizeHandle?: string;
}

/**
 * Resolved theme — every token is a literal CSS color string. This is what
 * render contexts (BlockStrategy, MarkDecorator, OverlayRenderHandler,
 * PageChromeContribution, PDF handlers) consume.
 *
 * `Partial<ResolvedTheme>` is the boundary type for `exportPdf({ theme })` —
 * caller injects literal colors, no DOM resolver runs.
 */
export interface ResolvedTheme {
  pageBg: string;
  pageShadow: string;
  defaultText: string;
  link: string;
  cursor: string;
  selectionFill: string;
  imagePlaceholderBg: string;
  imagePlaceholderBorder: string;
  imagePlaceholderText: string;
  listMarker: string;
  hrColor: string;
  resizeHandle: string;
}

/**
 * Default theme — matches every hardcoded color value used across Scrivr's
 * paint sites today, so apps that don't pass `theme` see zero visual change.
 *
 * Sources (kept in sync with paint sites):
 * - pageBg: white page background — canvas.ts clearCanvas
 * - pageShadow: subtle wrapper shadow — TileManager wrapper
 * - defaultText: slate-800 — TextBlockStrategy default fillColor
 * - link: indigo-600 — Link.ts LINK_COLOR
 * - cursor: slate-800 — OverlayRenderer cursor fill
 * - selectionFill: blue-500 @ 25% — OverlayRenderer selection rect
 * - imagePlaceholderBg / Border / Text: slate-100 / 300 / 500 — Image.ts
 * - listMarker: slate-800 — ListItemStrategy bullet/number fill
 * - hrColor: slate-300 — HorizontalRule.ts HR_COLOR
 * - resizeHandle: blue-500 — ResizeController.ts HANDLE_COLOR
 */
export const defaultEditorTheme: ResolvedTheme = Object.freeze({
  pageBg: "#ffffff",
  pageShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
  defaultText: "#1e293b",
  link: "#4f46e5",
  cursor: "#1e293b",
  selectionFill: "rgba(59, 130, 246, 0.25)",
  imagePlaceholderBg: "#f1f5f9",
  imagePlaceholderBorder: "#cbd5e1",
  imagePlaceholderText: "#64748b",
  listMarker: "#1e293b",
  hrColor: "#cbd5e1",
  resizeHandle: "#3b82f6",
});

/**
 * Default PDF theme — print-ready palette, intentionally independent of the
 * canvas theme. Ensures `editor.commands.exportPdf()` always produces a
 * shareable/printable document even when the canvas is themed dark.
 *
 * Caller can opt into a themed PDF by passing `exportPdf({ theme: {...} })`
 * with literal colors.
 */
export const defaultPdfTheme: ResolvedTheme = Object.freeze({
  pageBg: "#ffffff",
  pageShadow: "none",
  defaultText: "#000000",
  link: "#0066cc",
  cursor: "#000000",
  selectionFill: "rgba(0, 0, 0, 0)",
  imagePlaceholderBg: "#f5f5f5",
  imagePlaceholderBorder: "#cccccc",
  imagePlaceholderText: "#666666",
  listMarker: "#000000",
  hrColor: "#999999",
  resizeHandle: "#000000",
});

/**
 * Merge a partial theme over a base, returning a new frozen `EditorTheme`.
 *
 * Semantics:
 * - `undefined` → leave the base value alone
 * - `null` → reset that token to default (`defaultEditorTheme[key]`)
 * - any other value → override
 *
 * The result is always a complete EditorTheme view, but values may still be
 * `var(--...)` strings; the resolver turns them into literal colors.
 */
export function mergeEditorTheme(
  base: EditorTheme,
  partial: { [K in keyof EditorTheme]?: EditorTheme[K] | null | undefined },
): EditorTheme {
  const next: EditorTheme = { ...base };
  for (const key of Object.keys(partial) as Array<keyof EditorTheme>) {
    const value = partial[key];
    if (value === undefined) continue;
    if (value === null) {
      next[key] = defaultEditorTheme[key];
      continue;
    }
    next[key] = value;
  }
  return next;
}

/**
 * Returns true when a theme value contains a CSS variable reference. Used to
 * decide whether the MutationObserver auto-refresh path is worth installing.
 */
export function themeContainsCssVars(theme: EditorTheme): boolean {
  for (const key of Object.keys(theme) as Array<keyof EditorTheme>) {
    const value = theme[key];
    if (typeof value === "string" && value.includes("var(")) return true;
  }
  return false;
}
