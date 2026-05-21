/**
 * Thin wrapper around `fast-xml-parser` that produces a normalized
 * `OoxmlElement` tree — namespace-prefixed tag names preserved as-is
 * (`w:p`, `w:r`, …), attributes as a flat `Record<string, string>`,
 * children as an ordered mixed array of elements + text strings.
 *
 * fast-xml-parser's `preserveOrder: true` output is awkward to traverse
 * directly; this module normalizes it once at the boundary so the rest
 * of the importer can use a sane shape.
 */

import { XMLParser } from "fast-xml-parser";

export type OoxmlChild = OoxmlElement | string;

export interface OoxmlElement {
  name: string;
  attrs: Record<string, string>;
  children: OoxmlChild[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: true,
  parseAttributeValue: false,
  trimValues: false,
});

/**
 * Parse an OOXML string into a normalized tree. Returns the root element
 * (e.g. `<w:document>`), or `null` if the input has no root.
 *
 * Skips the leading `<?xml ...?>` declaration if present — fast-xml-parser
 * with `preserveOrder: true` emits the declaration as its own pseudo-node
 * keyed by `?xml`.
 */
export function parseOoxml(xml: string): OoxmlElement | null {
  const raw = parser.parse(xml);
  if (!Array.isArray(raw)) return null;
  const normalized = normalizeArray(raw);
  return normalized.find((el) => !el.name.startsWith("?")) ?? null;
}

// fast-xml-parser preserveOrder emits each node as an object with one
// tag-name key holding the children array + an optional ":@" key with
// the attributes. Text nodes are `{ "#text": "value" }`.
type FxpNode = Record<string, unknown>;

function normalizeArray(arr: unknown[]): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  for (const item of arr) {
    if (item == null || typeof item !== "object") continue;
    const node = normalizeNode(item as FxpNode);
    if (node) out.push(node);
  }
  return out;
}

function normalizeNode(node: FxpNode): OoxmlElement | null {
  const attrs = (node[":@"] as Record<string, string> | undefined) ?? {};
  let tagName: string | null = null;
  let childArr: unknown[] | null = null;
  for (const key of Object.keys(node)) {
    if (key === ":@") continue;
    if (key === "#text") return null; // handled at parent level
    tagName = key;
    const val = node[key];
    if (Array.isArray(val)) childArr = val;
    break;
  }
  if (tagName === null) return null;
  const children: OoxmlChild[] = [];
  if (childArr) {
    for (const item of childArr) {
      if (item == null || typeof item !== "object") continue;
      const fxp = item as FxpNode;
      const textVal = fxp["#text"];
      if (textVal !== undefined) {
        children.push(String(textVal));
        continue;
      }
      const child = normalizeNode(fxp);
      if (child) children.push(child);
    }
  }
  return { name: tagName, attrs, children };
}

// ── Traversal helpers ──────────────────────────────────────────────────────

/** First direct child with the given name, or `undefined`. */
export function findChild(el: OoxmlElement, name: string): OoxmlElement | undefined {
  for (const c of el.children) {
    if (typeof c !== "string" && c.name === name) return c;
  }
  return undefined;
}

/** All direct children with the given name. */
export function findChildren(el: OoxmlElement, name: string): OoxmlElement[] {
  const out: OoxmlElement[] = [];
  for (const c of el.children) {
    if (typeof c !== "string" && c.name === name) out.push(c);
  }
  return out;
}

/** Read an attribute value, or `undefined` if absent. */
export function attr(el: OoxmlElement, name: string): string | undefined {
  return el.attrs[name];
}

/** Concatenated text content (recursive). */
export function textContent(el: OoxmlElement): string {
  let out = "";
  for (const c of el.children) {
    out += typeof c === "string" ? c : textContent(c);
  }
  return out;
}
