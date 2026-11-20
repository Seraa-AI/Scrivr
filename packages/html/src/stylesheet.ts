/**
 * `<style>` rules, applied onto the elements they select before the parse
 * reads them — the parse rules only read an element's `style` attribute.
 *
 * Only the selectors a drafted document uses are applied: a type, `#id`,
 * `.class`, any compound of those, and comma lists of them. Between rules the
 * browser's cascade decides: importance, then inline over any rule, then the
 * more specific rule, then the later one. Anything not applied — combinators,
 * pseudo-classes, at-rules, a selector the DOM refuses — is reported, and the
 * rest of the sheet still applies.
 */

import { isReadableTextAlign } from "@scrivr/core";

const SIMPLE_SELECTOR = /^(?:[a-z][a-z0-9]*)?(?:#[\w-]+)?(?:\.[\w-]+)*$/i;

interface Declaration {
  value: string;
  important: boolean;
}

interface Winner extends Declaration {
  specificity: number;
}

/** Applies every `<style>` in the document, removes them, and returns the selectors and at-rules not applied. */
export function applyStylesheets(body: HTMLElement): string[] {
  const doc = body.ownerDocument;
  const unsupported: string[] = [];
  const winners = new Map<Element, Map<string, Winner>>();

  for (const sheet of Array.from(doc.querySelectorAll("style"))) {
    for (const { prelude, block } of topLevelRules(stripComments(sheet.textContent ?? ""))) {
      if (prelude.startsWith("@") || block === null) {
        unsupported.push(prelude);
        continue;
      }
      const selectors = prelude.split(",").map((s) => s.trim());
      // One empty entry invalidates the whole list, as in a browser.
      if (selectors.includes("")) {
        unsupported.push(prelude);
        continue;
      }
      const declarations = parseDeclarations(block);
      for (const selector of selectors) {
        const matched = SIMPLE_SELECTOR.test(selector) ? select(doc, selector) : null;
        if (matched === null) {
          unsupported.push(selector);
          continue;
        }
        const specificity = specificityOf(selector);
        for (const el of matched) {
          const props = winners.get(el) ?? new Map<string, Winner>();
          winners.set(el, props);
          for (const [property, declaration] of declarations) {
            const current = props.get(property);
            // Rules arrive in source order, so on a tie the later one wins.
            if (!current || outranks({ ...declaration, specificity }, current)) {
              props.set(property, { ...declaration, specificity });
            }
          }
        }
      }
    }
    sheet.remove();
  }

  for (const [el, props] of winners) {
    const inline = parseDeclarations(el.getAttribute("style") ?? "");
    for (const [property, winner] of props) {
      const own = inline.get(property);
      if (!own || (winner.important && !own.important)) inline.set(property, winner);
    }
    el.setAttribute("style", serializeDeclarations(inline));
  }

  return unsupported;
}

/** The elements `selector` matches, or null when the DOM cannot read it (`.2col`). */
function select(doc: Document, selector: string): Element[] | null {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return null;
  }
}

function outranks(a: Winner, b: Winner): boolean {
  if (a.important !== b.important) return a.important;
  return a.specificity >= b.specificity;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The stylesheet's top-level statements: a rule's prelude with its block, or
 * a block-less at-rule (`@import …;`) with `block: null`. A nested block, as
 * in `@media`, stays inside its at-rule's block. A block left open at the end
 * of the sheet is closed there, as a browser closes it.
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
  if (depth > 0) rules.push({ prelude, block: css.slice(start) });
  return rules;
}

/** The values a browser reads, for properties whose unreadable values matter: it drops the rest as it parses. */
const READABLE = new Map([["text-align", isReadableTextAlign]]);

/**
 * `color: red; font-size: 12px !important` → property → declaration, with the
 * property lowercased. A `;` inside quotes or parentheses — a data URL — is
 * part of its value, not the end of it. A declaration a browser would drop is
 * dropped here, before it can outrank the one it follows.
 */
export function parseDeclarations(block: string): Map<string, Declaration> {
  const out = new Map<string, Declaration>();
  for (const declaration of splitDeclarations(block)) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const raw = declaration.slice(colon + 1).trim();
    const important = /!\s*important\s*$/i.test(raw);
    const value = raw.replace(/!\s*important\s*$/i, "").trim();
    if (property && value && (READABLE.get(property)?.(value) ?? true)) out.set(property, { value, important });
  }
  return out;
}

function splitDeclarations(block: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let parens = 0;
  let start = 0;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(") {
      parens += 1;
    } else if (ch === ")") {
      parens = Math.max(0, parens - 1);
    } else if (ch === ";" && parens === 0) {
      parts.push(block.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(block.slice(start));
  return parts;
}

export function serializeDeclarations(declarations: Map<string, Declaration>): string {
  return [...declarations].map(([property, { value }]) => `${property}: ${value}`).join("; ");
}

/** Ids outweigh classes outweigh a type, as in CSS. */
function specificityOf(selector: string): number {
  const ids = (selector.match(/#/g) ?? []).length;
  const classes = (selector.match(/\./g) ?? []).length;
  const type = /^[a-z]/i.test(selector) ? 1 : 0;
  return ids * 10_000 + classes * 100 + type;
}
