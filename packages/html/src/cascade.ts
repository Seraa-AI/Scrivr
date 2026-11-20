/**
 * What CSS hands from an element to what it contains, where the parse would
 * not. The parse carries an element's text styles onto the text inside it,
 * as marks; block properties it does not carry at all.
 *
 * - `<body>` and `<html>` are never read — the parse starts at body's
 *   children — so their inherited styles move onto a wrapper around the page.
 * - Block properties pass from a block to the blocks inside it, and to a
 *   paragraph made for text sitting straight in it, so a centred cell centres
 *   its text.
 * - What an element states beats what it inherits: its own style, its
 *   `align`, and its defaults — a link keeps its colour, a heading its size.
 */

import { HTML_BLOCK_TAGS, HTML_IGNORED_TAGS, htmlShows, isHtmlElement } from "@scrivr/core";
import { parseDeclarations, serializeDeclarations } from "./stylesheet";

const TEXT = new Set(["color", "font-family", "font-size", "font-style", "font-weight"]);
const BLOCK = new Set(["text-align", "text-indent"]);

/** Text properties an element sets by default, so it takes none from outside. A bare `<a name>` is a bookmark, not a link. */
const OWN_DEFAULTS: Array<[selector: string, properties: string[]]> = [
  ["a[href]", ["color"]],
  ["h1, h2, h3, h4, h5, h6", ["font-size"]],
];

/** Attributes that state a block property, and the elements they state it on — a table's `align` places the table. */
const PRESENTATIONAL: Record<string, { attribute: string; on: ReadonlySet<string> }> = {
  "text-align": { attribute: "align", on: new Set(["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th"]) },
};

/** Blocks that never hold text of their own: text-only blocks, whose text is already a paragraph, and a table's frame. */
const NO_LOOSE_TEXT = new Set(["p", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tfoot", "tr"]);

/** For each element a block property was written onto, the element it came from. */
export type Carried = Map<Element, Map<string, Element>>;

type InheritedValue = { value: string; source: Element };
type Inherited = Map<string, InheritedValue>;

export const isBlockElement = (node: Node): boolean =>
  isHtmlElement(node) && HTML_BLOCK_TAGS.has(node.tagName.toLowerCase());

/**
 * Hands inherited styles down. Returns where each block property was carried
 * to, and the page's properties nothing inherits, such as its margin.
 */
export function cascadeInherited(body: HTMLElement): {
  carried: Carried;
  uninheritedProperties: Map<string, string>;
} {
  const doc = body.ownerDocument;
  const page = new Map([doc.documentElement, body].flatMap((el) => [...parseDeclarations(el.getAttribute("style") ?? "")]));
  const inherited = new Map([...page].filter(([property]) => TEXT.has(property) || BLOCK.has(property)));
  if (inherited.size > 0) {
    const wrapper = doc.createElement("div");
    wrapper.setAttribute("style", serializeDeclarations(inherited));
    wrapper.append(...Array.from(body.childNodes));
    body.append(wrapper);
  }

  const carried: Carried = new Map();
  for (const child of Array.from(body.children)) visit(child, new Map(), carried);
  const uninherited = [...page].filter(([property]) => !inherited.has(property));
  return { carried, uninheritedProperties: new Map(uninherited.map(([property, { value }]) => [property, value])) };
}

function visit(el: Element, outer: Inherited, carried: Carried): void {
  if (!isHtmlElement(el)) return;
  const tag = el.tagName.toLowerCase();
  if (HTML_IGNORED_TAGS.has(tag)) return;

  const own = parseDeclarations(el.getAttribute("style") ?? "");
  const stated = (property: string): string | null => {
    const presentational = PRESENTATIONAL[property];
    return own.get(property)?.value ?? (presentational?.on.has(tag) ? el.getAttribute(presentational.attribute) : null);
  };
  let inner = outer;

  if (HTML_BLOCK_TAGS.has(tag)) {
    inner = new Map(outer);
    for (const property of BLOCK) {
      const value = stated(property);
      if (value !== null) inner.set(property, { value, source: el });
    }
    carryOnto(el, own, [...outer].filter(([property]) => stated(property) === null), carried);
    if (!NO_LOOSE_TEXT.has(tag) && inner.size > 0) paragraphLooseText(el, inner, carried);
  }

  // An ancestor's colour or size reaches this text as a mark; `initial` is
  // what the reset rules read to clear it, as the element's own default would.
  const defaults = OWN_DEFAULTS.flatMap(([selector, properties]) => (el.matches(selector) ? properties : []));
  const unset = defaults.filter((property) => !own.has(property));
  if (unset.length > 0) {
    for (const property of unset) own.set(property, { value: "initial", important: false });
    el.setAttribute("style", serializeDeclarations(own));
  }

  for (const child of Array.from(el.children)) visit(child, inner, carried);
}

/**
 * Text sitting straight in a block, beside or instead of blocks, as a
 * paragraph of its own carrying the block's properties — where the parse
 * would make it a paragraph with none. A `<div>` of text alone is left to be
 * the paragraph itself.
 */
function paragraphLooseText(el: HTMLElement, values: Inherited, carried: Carried): void {
  const children = Array.from(el.childNodes);
  if (el.tagName.toLowerCase() === "div" && !children.some(isBlockElement)) return;

  let run: ChildNode[] = [];
  const flush = () => {
    const [first] = run;
    if (first && run.some(htmlShows)) {
      const paragraph = el.ownerDocument.createElement("p");
      first.before(paragraph);
      paragraph.append(...run);
      carryOnto(paragraph, new Map(), [...values], carried);
    }
    run = [];
  };
  for (const child of children) {
    if (isBlockElement(child)) flush();
    else run.push(child);
  }
  flush();
}

function carryOnto(
  el: HTMLElement,
  own: ReturnType<typeof parseDeclarations>,
  values: Array<[string, InheritedValue]>,
  carried: Carried,
): void {
  if (values.length === 0) return;
  const origins = carried.get(el) ?? new Map<string, Element>();
  carried.set(el, origins);
  for (const [property, { value, source }] of values) {
    own.set(property, { value, important: false });
    origins.set(property, source);
  }
  el.setAttribute("style", serializeDeclarations(own));
}
