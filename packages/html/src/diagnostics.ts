/**
 * What an HTML import could not carry into the document.
 *
 * Nothing here lists what Scrivr supports. The schema's own parse rules are
 * the authority: a style rule names the property it reads, and a tag rule's
 * `getAttrs` is watched for the `style` properties it reads — off the element
 * in front of it, and off any element it reaches from there, such as a
 * table's columns. Whatever the HTML says that no rule read is reported, so a
 * feature that ships its parse rule stops being reported with no change here.
 */

import { isHtmlElement } from "@scrivr/core";
import {
  DOMParser as PMDOMParser,
  type ParseRule,
  type Schema,
  type TagParseRule,
} from "@scrivr/core/pm";
import { INHERITED } from "./cascade";
import { parseDeclarations } from "./stylesheet";

export type HtmlDiagnosticCode =
  /** A CSS property no rule reads; the value was dropped. */
  | "html-style-unsupported"
  /** An element no rule reads; its text was kept, its meaning dropped. */
  | "html-element-unknown"
  /** An element the parse skips with everything in it, such as `<script>`. */
  | "html-element-ignored"
  /** An element its rule declined — an unsafe link, a `<b>` set to normal weight; its text was kept. */
  | "html-element-rejected"
  /** A stylesheet selector or at-rule that was not applied. */
  | "html-selector-unsupported";

export interface HtmlImportDiagnostic {
  level: "warning";
  code: HtmlDiagnosticCode;
  message: string;
  /** How many times it occurred. */
  count: number;
  /** The element, for the `html-element-*` codes. */
  tag?: string;
  /** The CSS property, for `html-style-unsupported`. */
  property?: string;
  /** The selector or at-rule, for `html-selector-unsupported`. */
  selector?: string;
}

/** What the steps before the parse could not apply. */
export interface PreparseLosses {
  unsupportedSelectors: string[];
  uninheritedProperties: string[];
}

/** A parser for `schema` that records what its rules read while parsing. */
export function watchedParser(schema: Schema): {
  parser: PMDOMParser;
  report: (body: HTMLElement, losses: PreparseLosses) => HtmlImportDiagnostic[];
} {
  const seen: Seen = { taken: new Set(), declined: new Set(), opaque: new Set(), readStyles: new Map() };
  const rules = PMDOMParser.fromSchema(schema).rules.map((rule) => (isTagRule(rule) ? watchTag(rule, schema, seen) : rule));
  // A style rule may match one value only (`font-style=italic`); the property is what it reads.
  const styleProperties = new Set(rules.flatMap((rule) => (isTagRule(rule) ? [] : [rule.style.split("=")[0] ?? ""])));
  return {
    parser: new PMDOMParser(schema, rules),
    report: (body, losses) => collect(body, losses, seen, styleProperties),
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
      const result = getAttrs ? getAttrs(watchElement(dom, seen)) : (attrs ?? null);
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

/** `el`, recording every `style` property read through it or through any element reached from it. */
function watchElement(el: HTMLElement, seen: Seen): HTMLElement {
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
    get: (target, prop) => (prop === "style" ? style : watchValue(bound(target, prop), target, seen)),
  });
}

/** An element or collection a rule reached, watched in turn; a method's result likewise. */
function watchValue(value: unknown, owner: object, seen: Seen): unknown {
  if (typeof value === "function") return (...args: unknown[]) => watchValue(value.apply(owner, args), owner, seen);
  if (isHtmlElement(value)) return watchElement(value, seen);
  if (isElementCollection(value)) {
    return new Proxy(value, {
      get(target, prop) {
        if (prop === Symbol.iterator) {
          return function* () {
            for (let i = 0; i < target.length; i++) yield watchValue(target.item(i), target, seen);
          };
        }
        return watchValue(bound(target, prop), target, seen);
      },
    });
  }
  return value;
}

/** `children`, `querySelectorAll(…)` and the like. */
function isElementCollection(value: unknown): value is { length: number; item(index: number): unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "length" in value &&
    typeof value.length === "number" &&
    "item" in value &&
    typeof value.item === "function"
  );
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
  "html-style-unsupported": (property, count) => `"${property}" is not supported here and was dropped (${count}×).`,
  "html-element-unknown": (tag, count) => `<${tag}> has no equivalent; its text was kept without it (${count}×).`,
  "html-element-ignored": (tag, count) => `<${tag}> and everything in it were dropped (${count}×).`,
  "html-element-rejected": (tag, count) =>
    `<${tag}> did not qualify for its rule as written; its text was kept without it (${count}×).`,
  "html-selector-unsupported": (selector, count) =>
    `The rule for "${selector}" was not applied; only type, #id and .class selectors are (${count}×).`,
};

type Subject = { tag: string } | { property: string } | { selector: string };

function collect(
  body: HTMLElement,
  losses: PreparseLosses,
  seen: Seen,
  styleProperties: Set<string>,
): HtmlImportDiagnostic[] {
  const found = new Map<string, { entry: Omit<HtmlImportDiagnostic, "message">; subject: string }>();
  const note = (code: HtmlDiagnosticCode, subject: Subject) => {
    const name = "tag" in subject ? subject.tag : "property" in subject ? subject.property : subject.selector;
    const key = `${code}:${name}`;
    const known = found.get(key);
    if (known) known.entry.count += 1;
    else found.set(key, { entry: { level: "warning", code, count: 1, ...subject }, subject: name });
  };

  // Shorthands expand: `margin` is applied when a rule read `margin-left` from it.
  const applied = (property: string, read: Set<string> | undefined) =>
    INHERITED.has(property) ||
    [...styleProperties, ...(read ?? [])].some((name) => name === property || name.startsWith(`${property}-`));

  const visit = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    // A container a rule turned down is still read through; nothing is lost.
    if (!seen.taken.has(el) && !TRANSPARENT.has(tag)) {
      if (IGNORED.has(tag)) return note("html-element-ignored", { tag });
      note(seen.declined.has(el) ? "html-element-rejected" : "html-element-unknown", { tag });
    }
    const read = seen.readStyles.get(el);
    for (const property of parseDeclarations(el.getAttribute("style") ?? "").keys()) {
      if (!applied(property, read)) note("html-style-unsupported", { property });
    }
    if (!seen.opaque.has(el)) for (const child of Array.from(el.children)) visit(child);
  };
  for (const selector of losses.unsupportedSelectors) note("html-selector-unsupported", { selector });
  for (const property of losses.uninheritedProperties) note("html-style-unsupported", { property });
  for (const child of Array.from(body.children)) visit(child);

  return [...found.values()].map(({ entry, subject }) => ({ ...entry, message: MESSAGES[entry.code](subject, entry.count) }));
}
