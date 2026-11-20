/**
 * What an HTML import could not carry into the document.
 *
 * Nothing here lists what Scrivr supports. The schema's own parse rules are
 * the authority: a style rule names the property it reads, and a tag rule's
 * `getAttrs` is watched for the `style` properties it reads off the element in
 * front of it. Whatever the HTML says that no rule read is reported, so a
 * feature that ships its parse rule stops being reported with no change here.
 */

import {
  DOMParser as PMDOMParser,
  type ParseRule,
  type Schema,
  type TagParseRule,
} from "@scrivr/core/pm";

export type HtmlDiagnosticCode =
  | "html-style-unsupported"
  | "html-element-unknown"
  | "html-element-ignored"
  | "html-element-rejected";

export interface HtmlImportDiagnostic {
  level: "warning";
  code: HtmlDiagnosticCode;
  message: string;
  /** How many elements it occurred on. */
  count: number;
  /** The element, for the `html-element-*` codes. */
  tag?: string;
  /** The CSS property, for `html-style-unsupported`. */
  property?: string;
}

/** A parser for `schema` that records what its rules read while parsing. */
export function watchedParser(schema: Schema): { parser: PMDOMParser; report: (body: HTMLElement) => HtmlImportDiagnostic[] } {
  const seen: Seen = { taken: new Set(), declined: new Set(), opaque: new Set(), readStyles: new Map() };
  const rules = PMDOMParser.fromSchema(schema).rules.map((rule) => (isTagRule(rule) ? watchTag(rule, schema, seen) : rule));
  // A style rule may match one value only (`font-style=italic`); the property is what it reads.
  const styleProperties = new Set(
    rules.flatMap((rule) => (isTagRule(rule) ? [] : [rule.style.split("=")[0] ?? ""])),
  );
  return {
    parser: new PMDOMParser(schema, rules),
    report: (body) => collect(body, seen, styleProperties),
  };
}

interface Seen {
  /** Elements a tag rule took. */
  taken: Set<Element>;
  /** Elements a tag rule looked at and turned away. */
  declined: Set<Element>;
  /** Taken elements whose children the parse never reads — leaves and `ignore` rules. */
  opaque: Set<Element>;
  /** The `style` properties a rule read off each element. */
  readStyles: Map<Element, Set<string>>;
}

const isTagRule = (rule: ParseRule): rule is TagParseRule => typeof rule.tag === "string";

function watchTag(rule: TagParseRule, schema: Schema, seen: Seen): TagParseRule {
  const { getAttrs, attrs } = rule;
  const opaque = rule.ignore === true || (rule.node !== undefined && schema.nodes[rule.node]?.isLeaf === true);
  return {
    ...rule,
    getAttrs: (dom) => {
      const result = getAttrs ? getAttrs(observeStyleReads(dom, seen)) : (attrs ?? null);
      if (result === false) {
        seen.declined.add(dom);
      } else {
        seen.taken.add(dom);
        if (opaque) seen.opaque.add(dom);
      }
      return result;
    },
  };
}

/** `el`, recording every `style` property read through it. */
function observeStyleReads(el: HTMLElement, seen: Seen): HTMLElement {
  const read = seen.readStyles.get(el) ?? new Set<string>();
  seen.readStyles.set(el, read);
  const style = new Proxy(el.style, {
    get(target, prop) {
      if (prop === "getPropertyValue") {
        return (name: string) => {
          read.add(name);
          return target.getPropertyValue(name);
        };
      }
      if (typeof prop === "string") read.add(kebabCase(prop));
      return bound(target, prop);
    },
  });
  return new Proxy(el, {
    get: (target, prop) => (prop === "style" ? style : bound(target, prop)),
  });
}

/** A DOM implementation's methods must run with the real object as `this`. */
function bound(target: object, prop: string | symbol): unknown {
  const value: unknown = Reflect.get(target, prop, target);
  return typeof value === "function" ? value.bind(target) : value;
}

const kebabCase = (camel: string) => camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Dropped with their content by the parser when no rule takes them. */
const IGNORED = new Set(["head", "noscript", "object", "script", "style", "title"]);

/** Containers with no meaning of their own; the parser reads straight through them. */
const TRANSPARENT = new Set(["div", "span", "tbody", "thead", "tfoot", "colgroup", "col"]);

const MESSAGES: Record<HtmlDiagnosticCode, (subject: string, count: number) => string> = {
  "html-style-unsupported": (property, count) =>
    `"${property}" is not supported here and was ignored on ${count} element(s).`,
  "html-element-unknown": (tag, count) =>
    `<${tag}> has no equivalent; its text was kept without it (${count}×).`,
  "html-element-ignored": (tag, count) => `<${tag}> and everything in it were dropped (${count}×).`,
  "html-element-rejected": (tag, count) =>
    `<${tag}> was refused by its rule — an unsafe URL, for one; its text was kept (${count}×).`,
};

function collect(body: HTMLElement, seen: Seen, styleProperties: Set<string>): HtmlImportDiagnostic[] {
  const found = new Map<string, Omit<HtmlImportDiagnostic, "message">>();
  const note = (code: HtmlDiagnosticCode, subject: { tag: string } | { property: string }) => {
    const key = `${code}:${"tag" in subject ? subject.tag : subject.property}`;
    const entry = found.get(key);
    if (entry) entry.count += 1;
    else found.set(key, { level: "warning", code, count: 1, ...subject });
  };

  const visit = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    // A container a rule turned down is still read through; nothing is lost.
    if (!seen.taken.has(el) && !TRANSPARENT.has(tag)) {
      if (IGNORED.has(tag)) return note("html-element-ignored", { tag });
      note(seen.declined.has(el) ? "html-element-rejected" : "html-element-unknown", { tag });
    }
    const read = seen.readStyles.get(el);
    for (const property of declaredStyles(el)) {
      if (!styleProperties.has(property) && !read?.has(property)) note("html-style-unsupported", { property });
    }
    if (!seen.opaque.has(el)) for (const child of Array.from(el.children)) visit(child);
  };
  for (const child of Array.from(body.children)) visit(child);

  return [...found.values()].map((entry) => ({
    ...entry,
    message: MESSAGES[entry.code](entry.tag ?? entry.property ?? "", entry.count),
  }));
}

/** The properties an element's `style` attribute declares, as the parser reads them. */
function declaredStyles(el: Element): string[] {
  const style = el.getAttribute("style") ?? "";
  return Array.from(style.matchAll(/\s*([\w-]+)\s*:\s*[^;]+/g), (m) => (m[1] ?? "").toLowerCase());
}
