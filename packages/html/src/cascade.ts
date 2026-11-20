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

import { HTML_BLOCK_TAGS, isHtmlElement } from "@scrivr/core";
import { IGNORED } from "./diagnostics";
import { parseDeclarations, serializeDeclarations } from "./stylesheet";

const TEXT = new Set(["color", "font-family", "font-size", "font-style", "font-weight"]);
const BLOCK = new Set(["text-align", "text-indent"]);

/** Text properties an element sets by default, so it takes none from outside. */
const OWN_DEFAULTS: Record<string, string[]> = {
  a: ["color"],
  h1: ["font-size"],
  h2: ["font-size"],
  h3: ["font-size"],
  h4: ["font-size"],
  h5: ["font-size"],
  h6: ["font-size"],
};

/** Blocks whose content is text, never blocks. */
const TEXTBLOCKS = new Set(["p", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** For each element a block property was written onto, the element it came from. */
export type Carried = Map<Element, Map<string, Element>>;

type Inherited = Map<string, { value: string; source: Element }>;

/** Hands inherited styles down, and returns the page's properties nothing inherits, such as its margin. */
export function cascadeInherited(body: HTMLElement): { carried: Carried; uninherited: string[] } {
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
  return { carried, uninherited: [...page.keys()].filter((property) => !inherited.has(property)) };
}

function visit(el: Element, outer: Inherited, carried: Carried): void {
  if (!isHtmlElement(el)) return;
  const tag = el.tagName.toLowerCase();
  if (IGNORED.has(tag)) return;

  const own = parseDeclarations(el.getAttribute("style") ?? "");
  const stated = (property: string) =>
    own.get(property)?.value ?? (property === "text-align" ? el.getAttribute("align") : null) ?? undefined;
  let inner = outer;

  if (HTML_BLOCK_TAGS.has(tag)) {
    inner = new Map(outer);
    for (const property of BLOCK) {
      const value = stated(property);
      if (value !== undefined) inner.set(property, { value, source: el });
    }
    write(el, own, [...outer].filter(([property]) => stated(property) === undefined), carried);
    if (!TEXTBLOCKS.has(tag) && inner.size > 0) paragraphLooseText(el, inner, carried);
  }

  const defaults = (OWN_DEFAULTS[tag] ?? []).filter((property) => !own.has(property));
  if (defaults.length > 0) {
    for (const property of defaults) own.set(property, { value: "initial", important: false });
    el.setAttribute("style", serializeDeclarations(own));
  }

  for (const child of Array.from(el.children)) visit(child, inner, carried);
}

/**
 * Text sitting straight in a block, beside or instead of blocks, as a
 * paragraph of its own carrying the block's properties — the paragraph the
 * parse would make for it, with nothing. A `<div>` of text alone is left to
 * be the paragraph itself.
 */
function paragraphLooseText(el: HTMLElement, values: Inherited, carried: Carried): void {
  const children = Array.from(el.childNodes);
  const isBlock = (node: ChildNode) => isHtmlElement(node) && HTML_BLOCK_TAGS.has(node.tagName.toLowerCase());
  if (el.tagName.toLowerCase() === "div" && !children.some(isBlock)) return;

  let run: ChildNode[] = [];
  const flush = () => {
    const [first] = run;
    if (first && run.some(shows)) {
      const paragraph = el.ownerDocument.createElement("p");
      first.before(paragraph);
      paragraph.append(...run);
      write(paragraph, new Map(), [...values], carried);
    }
    run = [];
  };
  for (const child of children) {
    if (isBlock(child)) flush();
    else run.push(child);
  }
  flush();
}

/** Something the reader sees: text, or an element holding text or nothing at all — a break, an image, a field. */
function shows(node: ChildNode): boolean {
  if (node.nodeType === 3 /* TEXT_NODE */) return (node.textContent ?? "").trim() !== "";
  if (!isHtmlElement(node) || IGNORED.has(node.tagName.toLowerCase())) return false;
  return !node.hasChildNodes() || Array.from(node.childNodes).some(shows);
}

function write(
  el: HTMLElement,
  own: ReturnType<typeof parseDeclarations>,
  values: Array<[string, { value: string; source: Element }]>,
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
