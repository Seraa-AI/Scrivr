/**
 * What an HTML import could not carry into the document.
 *
 * Nothing here lists what Scrivr supports. The schema's own parse rules are
 * the authority: a style rule takes a property when it accepts the value, and
 * a tag rule's `getAttrs` is watched for the `style` properties it reads — off
 * the element in front of it, and off any element it reaches from there, such
 * as a table's columns. A declaration is judged longhand by longhand, so
 * `margin: 24px 0` is reported when only its left margin was taken. Whatever
 * no rule took is reported, so a feature that ships its parse rule stops being
 * reported with no change here.
 */

import { HTML_IGNORED_TAGS, htmlShows, isHtmlElement } from "@scrivr/core";
import {
  DOMParser as PMDOMParser,
  type ParseRule,
  type Schema,
  type StyleParseRule,
  type TagParseRule,
} from "@scrivr/core/pm";
import { isBlockElement, type Carried } from "./cascade";
import { parseDeclarations } from "./stylesheet";

export type HtmlDiagnosticCode =
  /** A CSS property no rule took as written; the value was dropped. */
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

/** What the steps before the parse did: what they could not apply, and what they carried where. */
export interface Preparse {
  unsupportedSelectors: string[];
  /** The page's properties nothing inherits, with their values. */
  uninheritedProperties: Map<string, string>;
  carried: Carried;
}

/** A parser for `schema` that records what its rules read while parsing. */
export function watchedParser(schema: Schema): {
  parser: PMDOMParser;
  report: (body: HTMLElement, preparse: Preparse) => HtmlImportDiagnostic[];
} {
  const seen: Seen = {
    taken: new Set(),
    declined: new Set(),
    opaque: new Set(),
    readStyles: new Map(),
    watched: new WeakMap(),
  };
  const rules = PMDOMParser.fromSchema(schema).rules.map((rule) => (isTagRule(rule) ? watchTag(rule, schema, seen) : rule));
  const styleRules = rules.filter((rule): rule is StyleParseRule => !isTagRule(rule));
  return {
    parser: new PMDOMParser(schema, rules),
    report: (body, preparse) => collect(body, preparse, seen, styleRules),
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
  /** One watched stand-in per element, so a rule comparing elements finds them equal. */
  watched: WeakMap<HTMLElement, HTMLElement>;
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
  const known = seen.watched.get(el);
  if (known) return known;
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
  const watched = new Proxy(el, {
    get: (target, prop) => (prop === "style" ? style : watchValue(bound(target, prop), seen)),
  });
  seen.watched.set(el, watched);
  return watched;
}

/** An element or collection a rule reached, watched in turn; a method's result likewise. */
function watchValue(value: unknown, seen: Seen): unknown {
  if (typeof value === "function") return (...args: unknown[]) => watchValue(value(...args), seen);
  if (isHtmlElement(value)) return watchElement(value, seen);
  if (isElementCollection(value)) {
    return new Proxy(value, {
      get(target, prop) {
        if (prop === Symbol.iterator) {
          return function* () {
            for (let i = 0; i < target.length; i++) yield watchValue(target.item(i), seen);
          };
        }
        return watchValue(bound(target, prop), seen);
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

/** Containers with no meaning of their own; the parser reads straight through them. */
const TRANSPARENT = new Set(["div", "span", "tbody", "thead", "tfoot", "colgroup", "col"]);

const MESSAGES: Record<HtmlDiagnosticCode, (subject: string, count: number) => string> = {
  "html-style-unsupported": (property, count) => `"${property}" could not be applied as written and was dropped (${count}×).`,
  "html-element-unknown": (tag, count) => `<${tag}> has no equivalent; its text was kept without it (${count}×).`,
  "html-element-ignored": (tag, count) => `<${tag}> and everything in it were dropped (${count}×).`,
  "html-element-rejected": (tag, count) =>
    `<${tag}> did not qualify for its rule as written; its text was kept without it (${count}×).`,
  "html-selector-unsupported": (selector, count) =>
    `The rule for "${selector}" was not applied; only type, #id and .class selectors are (${count}×).`,
};

type Subject = { tag: string } | { property: string } | { selector: string };

function collect(body: HTMLElement, preparse: Preparse, seen: Seen, styleRules: StyleParseRule[]): HtmlImportDiagnostic[] {
  const found = new Map<string, { entry: Omit<HtmlImportDiagnostic, "message">; subject: string }>();
  const note = (code: HtmlDiagnosticCode, subject: Subject) => {
    const name = "tag" in subject ? subject.tag : "property" in subject ? subject.property : subject.selector;
    const key = `${code}:${name}`;
    const known = found.get(key);
    if (known) known.entry.count += 1;
    else found.set(key, { entry: { level: "warning", code, count: 1, ...subject }, subject: name });
  };

  const takenBy = (el: HTMLElement) => new Set([...(seen.readStyles.get(el) ?? []), ...takenByStyleRules(el, styleRules)]);
  // A value carried down is lost wherever it reached something shown and no
  // rule took it there. A container it only passed through loses nothing.
  const reached = new Pairs();
  const missed = new Pairs();
  for (const [target, origins] of preparse.carried) {
    if (!isHtmlElement(target)) continue;
    const taken = takenBy(target);
    const holdsContent = Array.from(target.childNodes).some((child) => !isBlockElement(child) && htmlShows(child));
    for (const [property, source] of origins) {
      reached.add(source, property);
      if (holdsContent && !covers(taken, property)) missed.add(source, property);
    }
  }
  const carriedOff = (el: Element, property: string) => reached.has(el, property) && !missed.has(el, property);

  const visit = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    // A container a rule turned down is still read through; nothing is lost.
    if (!seen.taken.has(el) && !TRANSPARENT.has(tag)) {
      if (HTML_IGNORED_TAGS.has(tag)) return note("html-element-ignored", { tag });
      note(seen.declined.has(el) ? "html-element-rejected" : "html-element-unknown", { tag });
    }
    if (isHtmlElement(el)) {
      const taken = takenBy(el);
      const written = preparse.carried.get(el);
      for (const [property, { value }] of parseDeclarations(el.getAttribute("style") ?? "")) {
        if (written?.has(property) || carriedOff(el, property)) continue;
        if (longhands(el, property, value).some((longhand) => !covers(taken, longhand))) {
          note("html-style-unsupported", { property });
        }
      }
    }
    if (!seen.opaque.has(el)) for (const child of Array.from(el.children)) visit(child);
  };
  for (const selector of preparse.unsupportedSelectors) note("html-selector-unsupported", { selector });
  for (const [property, value] of preparse.uninheritedProperties) {
    if (longhands(body, property, value).length > 0) note("html-style-unsupported", { property });
  }
  for (const child of Array.from(body.children)) visit(child);

  return [...found.values()].map(({ entry, subject }) => ({ ...entry, message: MESSAGES[entry.code](subject, entry.count) }));
}

class Pairs {
  private readonly byElement = new Map<Element, Set<string>>();
  add(el: Element, property: string): void {
    const properties = this.byElement.get(el) ?? new Set<string>();
    properties.add(property);
    this.byElement.set(el, properties);
  }
  has(el: Element, property: string): boolean {
    return this.byElement.get(el)?.has(property) ?? false;
  }
}

/** The properties of `el`'s style a style rule takes, as the parse matches them. */
function takenByStyleRules(el: HTMLElement, rules: StyleParseRule[]): string[] {
  return rules.flatMap((rule) => {
    const [property = "", only] = rule.style.split("=");
    const value = el.style.getPropertyValue(property);
    if (!value || (only !== undefined && only !== value)) return [];
    return !rule.getAttrs || rule.getAttrs(value) !== false ? [property] : [];
  });
}

/** Read as itself, or as part of a shorthand a rule read whole. */
function covers(taken: Set<string>, longhand: string): boolean {
  return [...taken].some((name) => name === longhand || longhand.startsWith(`${name}-`));
}

/** A CSS-wide keyword, or `normal` — the default a shorthand fills in, and what the rules that undo a mark read. */
const statesNothing = (value: string) => /^\s*(inherit|initial|unset|revert|revert-layer|normal)\s*$/i.test(value);

/**
 * What one declaration sets, longhand by longhand, leaving out what states
 * nothing: `margin: 24px 0` sets four margins, `background: #ff0` one colour.
 */
function longhands(el: HTMLElement, property: string, value: string): string[] {
  const probe = el.ownerDocument.createElement("span");
  probe.setAttribute("style", `${property}: ${value}`);
  const names = Array.from({ length: probe.style.length }, (_, i) => probe.style.item(i));
  // A property the DOM does not know expands to nothing; it is still a loss.
  if (names.length === 0) return statesNothing(value) ? [] : [property];
  return names.filter((name) => !statesNothing(probe.style.getPropertyValue(name)));
}
