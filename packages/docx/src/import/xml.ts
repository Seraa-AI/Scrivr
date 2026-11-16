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
import type { DocxUnreadElement } from "@scrivr/core";
import { isIgnored } from "./ignored";

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

/** `parseOoxml` for one package part, watched by `tracker` when there is one. */
export function parsePart(xml: string, part: string, tracker: ReadTracker | undefined): OoxmlElement | null {
  const root = parseOoxml(xml);
  return root && tracker ? tracker.track(part, root) : root;
}

// ── Read tracking ──────────────────────────────────────────────────────────

/** How far an element of a tracked tree was read. Absent: not at all. */
type ReadState = "examined" | "read";

/** A tracked element's tracker and the element it stands for. */
const trackedElements = new WeakMap<object, { tracker: ReadTracker; target: OoxmlElement }>();

/**
 * Records which elements of the trees it tracks get read, so an import can
 * report what it never looked at without the parser saying so: the parser
 * walks the tree it is given, and that tree notices.
 *
 * Reading an element's `attrs` or `children` reads it. Reading its `name`
 * only examines it: a proxy cannot tell a name that was matched and acted on
 * from one compared and passed over, so an element whose name is all it says
 * is read only when the import marks it handled (`markRead`). The search
 * helpers below look through the untracked tree: the element searched is
 * read, a hit is examined like any matched name, and the siblings a search
 * passed over stay unread.
 *
 * Read means looked at, not kept: a property the import reads and then
 * decides not to use is still read.
 */
export class ReadTracker {
  private readonly roots: Array<{ part: string; root: OoxmlElement }> = [];
  private readonly states = new WeakMap<OoxmlElement, ReadState>();
  private readonly proxies = new WeakMap<OoxmlElement, OoxmlElement>();
  private readonly wrappedChildren = new WeakMap<OoxmlElement, OoxmlChild[]>();

  /** Tracks `root`, the root of `part`, and returns the tree to parse instead. */
  track(part: string, root: OoxmlElement): OoxmlElement {
    this.roots.push({ part, root });
    return this.wrap(root);
  }

  /** `element`'s content was read. */
  read(element: OoxmlElement): void {
    this.states.set(element, "read");
  }

  /** `element`'s name was matched; returns it tracked, for the caller to read on. */
  matched(element: OoxmlElement): OoxmlElement {
    this.examine(element);
    return this.wrap(element);
  }

  /**
   * What nobody read, in the order the parts were tracked and then document
   * order, with what is dropped on purpose listed as `ignored`.
   */
  unread(): DocxUnreadElement[] {
    const entries = new Map<string, DocxUnreadElement>();
    const record = (part: string, path: string, outcome: DocxUnreadElement["outcome"]) => {
      const key = `${part}
${path}
${outcome}`;
      const entry = entries.get(key);
      if (entry) entry.count += 1;
      else entries.set(key, { part, path, outcome, count: 1 });
    };
    const visit = (part: string, element: OoxmlElement, parent: string | undefined, path: string) => {
      if (isIgnored(parent, element.name)) {
        record(part, path, "ignored");
        return;
      }
      const state = this.states.get(element);
      if (state !== "read") {
        record(part, path, state ?? "unread");
        return;
      }
      for (const child of element.children) {
        if (typeof child !== "string") visit(part, child, element.name, `${path}/${child.name}`);
      }
    };
    for (const { part, root } of this.roots) visit(part, root, undefined, root.name);
    return [...entries.values()];
  }

  private wrap(element: OoxmlElement): OoxmlElement {
    const existing = this.proxies.get(element);
    if (existing) return existing;
    const proxy = new Proxy(element, {
      get: (target, key, receiver) => {
        if (key === "name") this.examine(target);
        else if (key === "attrs") this.read(target);
        else if (key === "children") {
          this.read(target);
          return this.childrenOf(target);
        }
        return Reflect.get(target, key, receiver);
      },
    });
    this.proxies.set(element, proxy);
    trackedElements.set(proxy, { tracker: this, target: element });
    return proxy;
  }

  private examine(element: OoxmlElement): void {
    if (this.states.get(element) !== "read") this.states.set(element, "examined");
  }

  private childrenOf(element: OoxmlElement): OoxmlChild[] {
    const existing = this.wrappedChildren.get(element);
    if (existing) return existing;
    const children = element.children.map((child) => (typeof child === "string" ? child : this.wrap(child)));
    this.wrappedChildren.set(element, children);
    return children;
  }
}

/**
 * Mark an element whose name is all it says — a run's `<w:tab/>` — as read,
 * where the import handles it. Does nothing to an untracked element.
 */
export function markRead(el: OoxmlElement): void {
  const tracked = trackedElements.get(el);
  if (tracked) tracked.tracker.read(tracked.target);
}

/**
 * The children a search should look through, and how to hand back what it
 * found or went through. Searching an element reads it; for a tracked one the
 * search runs over its untracked children, so the ones it passes over stay
 * unread.
 */
function searchable(el: OoxmlElement): {
  children: OoxmlChild[];
  found: (element: OoxmlElement) => OoxmlElement;
  searchedIn: (element: OoxmlElement) => void;
} {
  const tracked = trackedElements.get(el);
  if (!tracked) return { children: el.children, found: (element) => element, searchedIn: () => {} };
  const { tracker, target } = tracked;
  tracker.read(target);
  return {
    children: target.children,
    found: (element) => tracker.matched(element),
    searchedIn: (element) => tracker.read(element),
  };
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
  const { children, found } = searchable(el);
  for (const c of children) {
    if (typeof c !== "string" && c.name === name) return found(c);
  }
  return undefined;
}

/**
 * Whether a direct child with the given name is there — for an element whose
 * presence is all the import takes from it, such as `<w:tblHeader/>`, so
 * finding it reads it.
 */
export function hasChild(el: OoxmlElement, name: string): boolean {
  const child = findChild(el, name);
  if (child) markRead(child);
  return child !== undefined;
}

/** All direct children with the given name. */
export function findChildren(el: OoxmlElement, name: string): OoxmlElement[] {
  const { children, found } = searchable(el);
  const out: OoxmlElement[] = [];
  for (const c of children) {
    if (typeof c !== "string" && c.name === name) out.push(found(c));
  }
  return out;
}

/**
 * First descendant with the given name, depth first, or `undefined`. Real
 * OOXML wraps content in `<mc:AlternateContent>` and similar, so a fixed path
 * misses it.
 */
export function findDescendant(el: OoxmlElement, name: string): OoxmlElement | undefined {
  const { children, found, searchedIn } = searchable(el);
  // The elements from `el` down to the hit: the search looked inside each.
  const search = (siblings: OoxmlChild[]): OoxmlElement[] | undefined => {
    for (const child of siblings) {
      if (typeof child === "string") continue;
      if (child.name === name) return [child];
      const inner = search(child.children);
      if (inner) return [child, ...inner];
    }
    return undefined;
  };
  const path = search(children);
  const hit = path?.pop();
  if (!path || !hit) return undefined;
  path.forEach(searchedIn);
  return found(hit);
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
