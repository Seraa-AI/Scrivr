/**
 * Whether `value` is an HTML element, judged by its shape.
 *
 * `instanceof HTMLElement` asks whether the element came from this realm's
 * DOM. A server has no global DOM, and a parser such as happy-dom builds its
 * elements from its own classes, so there that check throws or fails even on
 * a real element. Parse rules must read HTML wherever it was parsed.
 */
export function isHtmlElement(value: unknown): value is HTMLElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === 1 &&
    "getAttribute" in value &&
    typeof value.getAttribute === "function"
  );
}
