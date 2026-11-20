import { isReadableTextAlign, parseTextAlign, type TextAlign } from "./cssValues";
import { isHtmlElement } from "./isHtmlElement";

/**
 * Elements that open a block of their own when they appear in HTML. A `<div>`
 * of inline content is read as a paragraph only when none of these is inside
 * it; the HTML importer carries block properties onto these.
 */
export const HTML_BLOCK_TAGS: ReadonlySet<string> = new Set([
  "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
  "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/** Elements the parse drops with everything in them when no rule takes them. */
export const HTML_IGNORED_TAGS: ReadonlySet<string> = new Set(["head", "noscript", "object", "script", "style", "title"]);

/** Inline atoms that show with nothing inside, as an empty span does not. */
const SHOWS_EMPTY = "br, img[src], span[data-field]";

/** Whether `node` is an element that opens a block of its own. */
export const isHtmlBlock = (node: Node): boolean =>
  isHtmlElement(node) && HTML_BLOCK_TAGS.has(node.tagName.toLowerCase());

/** Whether `node` puts something on the page: text, or an inline atom, at any depth. */
export function htmlShows(node: Node): boolean {
  // CSS whitespace only: a non-breaking space holds a line.
  if (node.nodeType === 3 /* TEXT_NODE */) return /[^ \t\n\r\f]/.test(node.textContent ?? "");
  if (!isHtmlElement(node) || HTML_IGNORED_TAGS.has(node.tagName.toLowerCase())) return false;
  return node.matches(SHOWS_EMPTY) || Array.from(node.childNodes).some(htmlShows);
}

/** HTML's `align` values — not CSS's: a browser ignores `align="end"`. */
const HTML_ALIGN = new Map<string, TextAlign>([
  ["left", "left"],
  ["right", "right"],
  ["center", "center"],
  ["middle", "center"],
  ["justify", "justify"],
]);

/** An HTML `align` attribute as one of the editor's four, or null when a browser would ignore it. */
export function htmlAlign(value: string): TextAlign | null {
  return HTML_ALIGN.get(value.trim().toLowerCase()) ?? null;
}

/** An element's alignment: its `text-align` if a browser reads it — `inherit` included — else its `align`. */
export function elementTextAlign(el: HTMLElement): TextAlign | null {
  const styled = el.style.textAlign;
  return isReadableTextAlign(styled) ? parseTextAlign(styled) : htmlAlign(el.getAttribute("align") ?? "");
}
