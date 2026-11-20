/**
 * What CSS hands from an element to what it contains, for the two cases the
 * parse does not cover on its own. (It already carries an element's own text
 * styles onto that element's content.)
 *
 * - `<body>` and `<html>` are never read — the parse starts at body's
 *   children — so their text styles go onto the text itself, run by run. An
 *   element's own default still wins, as in a browser: a link keeps its
 *   colour, a heading its size, `<b>` its weight.
 * - Block properties pass from a container to the blocks inside it, so a
 *   centred `<div>` centres its paragraphs.
 */

import { isHtmlElement } from "@scrivr/core";
import { parseDeclarations, serializeDeclarations } from "./stylesheet";

/** Applied to text, as marks. */
const TEXT = new Set(["color", "font-family", "font-size", "font-style", "font-weight"]);
/** Written onto blocks, as block attributes. */
const BLOCK = new Set(["text-align", "text-indent"]);
/** Properties the cascade carries to where a rule reads them. */
export const INHERITED = new Set([...TEXT, ...BLOCK]);

const HEADING = ["font-size", "font-weight"];

/** Text properties an element sets by default, so it does not take them from the page. */
const OWN_DEFAULTS: Record<string, string[]> = {
  a: ["color"],
  h1: HEADING,
  h2: HEADING,
  h3: HEADING,
  h4: HEADING,
  h5: HEADING,
  h6: HEADING,
  b: ["font-weight"],
  strong: ["font-weight"],
  th: ["font-weight"],
  i: ["font-style"],
  em: ["font-style"],
  code: ["font-family"],
  kbd: ["font-family"],
  pre: ["font-family"],
  samp: ["font-family"],
};

/** Content the parse never reads. */
const SKIPPED = new Set(["script", "style", "noscript", "template"]);

type Values = Map<string, string>;

/** Hands inherited styles down, and returns the page's properties no block inherits, such as its margin. */
export function cascadeInherited(body: HTMLElement): string[] {
  const page: Values = new Map();
  for (const el of [body.ownerDocument.documentElement, body]) {
    for (const [property, { value }] of parseDeclarations(el.getAttribute("style") ?? "")) page.set(property, value);
  }
  const pick = (names: Set<string>) => new Map([...page].filter(([property]) => names.has(property)));
  for (const child of Array.from(body.childNodes)) visit(child, pick(TEXT), pick(BLOCK));
  return [...page.keys()].filter((property) => !INHERITED.has(property));
}

function visit(node: ChildNode, pageText: Values, block: Values): void {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    if (pageText.size > 0 && (node.textContent ?? "").trim() !== "") wrapInStyle(node, pageText);
    return;
  }
  if (!isHtmlElement(node)) return;
  const tag = node.tagName.toLowerCase();
  if (SKIPPED.has(tag)) return;

  const own = parseDeclarations(node.getAttribute("style") ?? "");
  const missing = [...block].filter(([property]) => !own.has(property));
  if (missing.length > 0) {
    for (const [property, value] of missing) own.set(property, { value, important: false });
    node.setAttribute("style", serializeDeclarations(own));
  }

  const nextBlock: Values = new Map();
  for (const [property, { value }] of own) if (BLOCK.has(property)) nextBlock.set(property, value);
  const stops = new Set([...own.keys(), ...(OWN_DEFAULTS[tag] ?? [])]);
  const nextText = new Map([...pageText].filter(([property]) => !stops.has(property)));
  for (const child of Array.from(node.childNodes)) visit(child, nextText, nextBlock);
}

function wrapInStyle(text: ChildNode, values: Values): void {
  const span = text.ownerDocument?.createElement("span");
  if (!span) return;
  span.setAttribute("style", [...values].map(([property, value]) => `${property}: ${value}`).join("; "));
  text.replaceWith(span);
  span.append(text);
}
