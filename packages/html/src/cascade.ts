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

import {
  HTML_BLOCK_TAGS,
  HTML_IGNORED_TAGS,
  htmlAlign,
  htmlShows,
  isCssWideKeyword,
  isHtmlBlock,
  isHtmlElement,
  parseTextAlign,
  safeUrl,
} from "@scrivr/core";
import { parseDeclarations, serializeDeclarations } from "./stylesheet";

const TEXT_PROPERTIES = new Set(["color", "font-family", "font-size", "font-style", "font-weight"]);
/** Block properties, which the cascade carries since the parse does not. */
export const BLOCK_PROPERTIES: ReadonlySet<string> = new Set(["text-align", "text-indent"]);

export const HEADINGS: ReadonlyArray<string> = ["h1", "h2", "h3", "h4", "h5", "h6"];

/**
 * Text properties an element sets by default, so it takes none from outside.
 * A link sets its colour only if the editor keeps it: a bare `<a name>` is a
 * bookmark, an unsafe href plain text.
 */
const OWN_DEFAULTS: Array<[setsOwn: (el: Element) => boolean, properties: string[]]> = [
  [(el) => el.matches("a[href]") && safeUrl(el.getAttribute("href")) !== null, ["color"]],
  [(el) => HEADINGS.includes(el.tagName.toLowerCase()), ["font-size"]],
];

/** The block property values a browser reads; a declaration it cannot read, it drops. */
const READABLE: Record<string, (value: string) => boolean> = {
  "text-align": (value) => isCssWideKeyword(value) || parseTextAlign(value) !== null,
};

/**
 * Attributes that state a block property, the elements they state it on — a
 * table's `align` places the table — and how a browser reads their value into
 * CSS; one it ignores states nothing. Moved into the style, so diagnostics
 * judge them as they judge a style, and the parse sees only what the cascade
 * decided.
 */
const PRESENTATIONAL: Record<
  string,
  { attribute: string; on: ReadonlySet<string>; read: (value: string) => string | null }
> = {
  "text-align": {
    attribute: "align",
    on: new Set(["div", "p", ...HEADINGS, "td", "th", "tr", "thead", "tbody", "tfoot"]),
    read: htmlAlign,
  },
};

/** Keywords that make a property inherit; `initial` is not one, since it states the default. */
export const INHERITING_KEYWORD = /^\s*(inherit|unset|revert|revert-layer)\s*$/i;

/** Blocks whose loose text needs no paragraph: a text block already is one, and a table's frame holds none. */
const NO_LOOSE_TEXT = new Set(["p", "pre", ...HEADINGS, "table", "thead", "tbody", "tfoot", "tr"]);

/** For each element a block property was written onto, the element it came from. */
export type Carried = Map<Element, Map<string, Element>>;

type InheritedValue = { value: string; source: Element };
type Inherited = Map<string, InheritedValue>;

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
  const inherited = new Map([...page].filter(([property]) => TEXT_PROPERTIES.has(property) || BLOCK_PROPERTIES.has(property)));
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
  const original = serializeDeclarations(own);
  for (const [property, readable] of Object.entries(READABLE)) {
    if (!readable(own.get(property)?.value ?? "")) own.delete(property);
  }
  // An attribute counts only where the style says nothing — even `inherit` beats it.
  for (const [property, { attribute, on, read }] of Object.entries(PRESENTATIONAL)) {
    if (!on.has(tag)) continue;
    const presented = own.has(property) ? null : read(el.getAttribute(attribute) ?? "");
    if (presented !== null) own.set(property, { value: presented, important: false });
    el.removeAttribute(attribute);
  }
  for (const property of BLOCK_PROPERTIES) {
    if (INHERITING_KEYWORD.test(own.get(property)?.value ?? "")) own.delete(property);
  }
  let inner = outer;

  if (HTML_BLOCK_TAGS.has(tag)) {
    inner = new Map(outer);
    for (const property of BLOCK_PROPERTIES) {
      const value = own.get(property)?.value;
      if (value !== undefined) inner.set(property, { value, source: el });
    }
    carryOnto(el, own, [...outer].filter(([property]) => !own.has(property)), carried);
    if (!NO_LOOSE_TEXT.has(tag) && inner.size > 0) paragraphLooseText(el, inner, carried);
  }

  // An ancestor's colour or size reaches this text as a mark; `initial` is
  // what the reset rules read to clear it, as the element's own default would.
  const defaults = OWN_DEFAULTS.flatMap(([setsOwn, properties]) => (setsOwn(el) ? properties : []));
  for (const property of defaults) if (!own.has(property)) own.set(property, { value: "initial", important: false });

  const restyled = serializeDeclarations(own);
  if (restyled !== original) el.setAttribute("style", restyled);

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
  if (el.tagName.toLowerCase() === "div" && !children.some(isHtmlBlock)) return;

  let run: ChildNode[] = [];
  const flush = () => {
    const [first] = run;
    if (first && run.some(htmlShows)) {
      const paragraph = el.ownerDocument.createElement("p");
      first.before(paragraph);
      paragraph.append(...run);
      const own = parseDeclarations("");
      carryOnto(paragraph, own, [...values], carried);
      paragraph.setAttribute("style", serializeDeclarations(own));
    }
    run = [];
  };
  for (const child of children) {
    if (isHtmlBlock(child)) flush();
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
}
