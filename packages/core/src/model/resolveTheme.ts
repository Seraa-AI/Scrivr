import type { EditorTheme, ResolvedTheme } from "./theme";
import { defaultEditorTheme } from "./theme";

/**
 * Theme resolver — turns an `EditorTheme` (which may contain CSS variable
 * references like `var(--scrivr-page-bg)`) into a `ResolvedTheme` (literal
 * CSS color strings ready to assign to `ctx.fillStyle`).
 *
 * Strategy: a hidden `<div>` probe attached to the editor's `themeRoot`. For
 * each token, set `probe.style.color = value` and read back the computed
 * style. The browser handles every CSS color form for free — `var(--x)`,
 * `var(--missing, fallback)`, nested fallbacks, `color-mix()`, `oklch()`,
 * `calc()`, and so on.
 *
 * Failure is fail-closed: if the browser cannot resolve `value` to a valid
 * color, the resolver falls back to the default token value rather than
 * letting an invalid string reach `ctx.fillStyle` (which silently keeps the
 * previous fill).
 *
 * The probe element is created lazily on first resolve and pinned to the
 * `themeRoot`. Editors should call `disposeProbe(themeRoot)` from their
 * destroy path to remove it.
 */

const PROBE_ATTR = "data-scrivr-theme-probe";

/**
 * Returns the hidden probe element attached to `themeRoot`, creating it on
 * first call. Multiple editors sharing a `themeRoot` reuse the same probe.
 */
function ensureProbe(themeRoot: HTMLElement): HTMLDivElement {
  const existing = themeRoot.querySelector<HTMLDivElement>(`div[${PROBE_ATTR}]`);
  if (existing) return existing;
  const probe = themeRoot.ownerDocument.createElement("div");
  probe.setAttribute(PROBE_ATTR, "");
  probe.style.cssText =
    "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;";
  themeRoot.appendChild(probe);
  return probe;
}

/**
 * Resolve a single theme color value through the browser's CSS engine.
 *
 * @param value — any CSS color string (literal, `var(--token)`, `color-mix(...)`, etc.)
 * @param themeRoot — the element whose computed CSS variables drive `var(...)` lookups
 * @param fallback — used when `value` cannot be resolved to a valid color
 */
export function resolveThemeColor(
  value: string,
  themeRoot: HTMLElement,
  fallback: string,
): string {
  const probe = ensureProbe(themeRoot);
  probe.style.color = "";
  probe.style.color = value;
  if (probe.style.color === "") return fallback;
  const computed = probe.ownerDocument.defaultView?.getComputedStyle(probe).color;
  if (!computed || computed === "rgba(0, 0, 0, 0)") return fallback;
  return computed;
}

/**
 * Tokens whose value is consumed by the DOM CSS engine directly (assigned to
 * a `style.*` property), not piped through `ctx.fillStyle`. The browser
 * resolves `var(...)` natively at apply time, so we pass these through
 * verbatim instead of running them through the probe (which would reject
 * non-color values like a multi-part box-shadow).
 */
const DOM_PASSTHROUGH: ReadonlySet<keyof ResolvedTheme> = new Set(["pageShadow"]);

/**
 * Resolve every token in an `EditorTheme` to a literal color (or a verbatim
 * DOM-applied string for passthrough tokens), falling back to
 * `defaultEditorTheme` per token on resolver failure.
 *
 * Called once per `setTheme()` (and on observed `themeRoot` mutations); the
 * result is stored on the editor and read by every paint site.
 */
export function resolveTheme(theme: EditorTheme, themeRoot: HTMLElement): ResolvedTheme {
  const out = {} as ResolvedTheme;
  for (const key of Object.keys(defaultEditorTheme) as Array<keyof ResolvedTheme>) {
    const raw = theme[key];
    const fallback = defaultEditorTheme[key];
    if (raw === undefined) {
      out[key] = fallback;
      continue;
    }
    if (DOM_PASSTHROUGH.has(key)) {
      out[key] = raw;
      continue;
    }
    out[key] = resolveThemeColor(raw, themeRoot, fallback);
  }
  return Object.freeze(out);
}

/**
 * Remove the probe element, if any. Editors call this from `destroy()`.
 * Safe to call multiple times.
 */
export function disposeProbe(themeRoot: HTMLElement): void {
  const probe = themeRoot.querySelector(`div[${PROBE_ATTR}]`);
  if (probe?.parentNode) probe.parentNode.removeChild(probe);
}
