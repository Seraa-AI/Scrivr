/**
 * `<style>` rules, applied onto the elements they select before the parse
 * reads them — the parse rules only read an element's `style` attribute.
 *
 * Only the selectors a drafted document uses are applied: a type, `#id`,
 * `.class`, any compound of those, and comma lists of them. A browser's
 * cascade decides between rules: an inline declaration beats every rule, then
 * the more specific rule, then the later one. Anything else — combinators,
 * pseudo-classes, at-rules — is reported, not guessed at.
 */

export interface StylesheetResult {
  /** Selectors and at-rules not applied, once per occurrence, in source order. */
  unsupportedSelectors: string[];
  /** Properties set on `<html>`/`<body>` that no block inherits, such as the page margin. */
  uninheritedProperties: string[];
}

/** Properties a block's text takes from `<body>` when it does not set its own. */
const INHERITED = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "text-align",
  "text-indent",
]);

const SIMPLE_SELECTOR = /^(?:[a-z][a-z0-9]*)?(?:#[\w-]+)?(?:\.[\w-]+)*$/i;

interface Winner {
  value: string;
  specificity: number;
}

export function applyStylesheets(body: HTMLElement): StylesheetResult {
  const doc = body.ownerDocument;
  const unsupportedSelectors: string[] = [];
  const winners = new Map<Element, Map<string, Winner>>();

  for (const sheet of Array.from(doc.querySelectorAll("style"))) {
    for (const { prelude, block } of topLevelRules(stripComments(sheet.textContent ?? ""))) {
      if (prelude.startsWith("@") || block === null) {
        unsupportedSelectors.push(prelude);
        continue;
      }
      const declarations = parseDeclarations(block);
      for (const selector of prelude.split(",").map((s) => s.trim())) {
        if (!selector || !SIMPLE_SELECTOR.test(selector)) {
          unsupportedSelectors.push(selector);
          continue;
        }
        const specificity = specificityOf(selector);
        for (const el of Array.from(doc.querySelectorAll(selector))) {
          const props = winners.get(el) ?? new Map<string, Winner>();
          winners.set(el, props);
          for (const [property, value] of declarations) {
            const current = props.get(property);
            // Rules arrive in source order, so on a tie the later one wins.
            if (!current || specificity >= current.specificity) props.set(property, { value, specificity });
          }
        }
      }
    }
    sheet.remove();
  }

  for (const [el, props] of winners) {
    const inline = parseDeclarations(el.getAttribute("style") ?? "");
    for (const [property, { value }] of props) if (!inline.has(property)) inline.set(property, value);
    el.setAttribute("style", serialize(inline));
  }

  return { unsupportedSelectors, uninheritedProperties: inheritFromBody(body) };
}

/**
 * The parser reads `<body>`'s children, never `<body>` itself, so what it and
 * `<html>` set is handed down to every element that does not set it — an
 * element setting a property passes its own value down instead.
 */
function inheritFromBody(body: HTMLElement): string[] {
  const root = body.ownerDocument.documentElement;
  const page = parseDeclarations(root.getAttribute("style") ?? "");
  for (const [property, value] of parseDeclarations(body.getAttribute("style") ?? "")) page.set(property, value);

  const inherited = new Map([...page].filter(([property]) => INHERITED.has(property)));
  const handDown = (el: Element, from: Map<string, string>) => {
    const own = parseDeclarations(el.getAttribute("style") ?? "");
    const missing = [...from].filter(([property]) => !own.has(property));
    if (missing.length > 0) el.setAttribute("style", serialize(new Map([...missing, ...own])));
    const next = new Map(from);
    for (const [property, value] of own) if (INHERITED.has(property)) next.set(property, value);
    for (const child of Array.from(el.children)) handDown(child, next);
  };
  if (inherited.size > 0) for (const child of Array.from(body.children)) handDown(child, inherited);

  return [...page.keys()].filter((property) => !INHERITED.has(property));
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The stylesheet's top-level statements: a rule's prelude with its block, or
 * a block-less at-rule (`@import …;`) with `block: null`. A nested block, as
 * in `@media`, stays inside its at-rule's block.
 */
function topLevelRules(css: string): Array<{ prelude: string; block: string | null }> {
  const rules: Array<{ prelude: string; block: string | null }> = [];
  let depth = 0;
  let start = 0;
  let prelude = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = css.slice(start, i).trim();
        start = i + 1;
      }
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        rules.push({ prelude, block: css.slice(start, i) });
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      const statement = css.slice(start, i).trim();
      if (statement) rules.push({ prelude: statement, block: null });
      start = i + 1;
    }
  }
  return rules;
}

/** `color: red; font-size: 12px !important` → property → value, lowercased property. */
function parseDeclarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const declaration of block.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).replace(/!important/i, "").trim();
    if (property && value) out.set(property, value);
  }
  return out;
}

function serialize(declarations: Map<string, string>): string {
  return [...declarations].map(([property, value]) => `${property}: ${value}`).join("; ");
}

/** Ids outweigh classes outweigh a type, as in CSS. */
function specificityOf(selector: string): number {
  const ids = (selector.match(/#/g) ?? []).length;
  const classes = (selector.match(/\./g) ?? []).length;
  const type = /^[a-z]/i.test(selector) ? 1 : 0;
  return ids * 10_000 + classes * 100 + type;
}
