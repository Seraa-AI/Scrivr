/**
 * Minimal XML builder + serializer for DOCX export.
 *
 * Determinism is load-bearing: golden-test diffs against produced
 * `document.xml` must be stable, so attributes are emitted in
 * alphabetical order regardless of insertion order.
 */

import type { XmlNode } from "./context";

export type XmlAttrs = Record<string, string>;
export type XmlChild = XmlNode | string;

/**
 * Construct an `XmlNode`. Empty `attrs` and `children` are omitted so the
 * resulting object compares cleanly in tests.
 */
export function xml(
  name: string,
  attrs?: XmlAttrs,
  children?: XmlChild[],
): XmlNode {
  const node: XmlNode = { name };
  if (attrs && Object.keys(attrs).length > 0) {
    node.attributes = attrs;
  }
  if (children && children.length > 0) {
    node.children = children;
  }
  return node;
}

export interface SerializeOptions {
  /** Prefix output with `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`. */
  declaration?: boolean;
}

/** Serialize an `XmlNode` tree to a compact, deterministic XML string. */
export function serializeXml(root: XmlNode, options: SerializeOptions = {}): string {
  const body = serializeNode(root);
  return options.declaration
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`
    : body;
}

function serializeNode(node: XmlNode): string {
  const attrs = serializeAttrs(node.attributes);
  const hasChildren = node.children && node.children.length > 0;

  if (!hasChildren) {
    return `<${node.name}${attrs}/>`;
  }

  const inner = node.children!.map(serializeChild).join("");
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

function serializeChild(child: XmlChild): string {
  return typeof child === "string" ? escapeText(child) : serializeNode(child);
}

function serializeAttrs(attrs: XmlAttrs | undefined): string {
  if (!attrs) return "";
  const keys = Object.keys(attrs).sort();
  if (keys.length === 0) return "";
  return keys
    .map((k) => ` ${k}="${escapeAttr(attrs[k] ?? "")}"`)
    .join("");
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    return "&gt;";
  });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    return "&quot;";
  });
}
