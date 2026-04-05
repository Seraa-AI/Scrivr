import { Mark } from "prosemirror-model";
import type { FontModifier } from "../extensions/types";

/**
 * StyleResolver — converts a base font string + ProseMirror marks into a
 * canonical CSS font string safe to assign to ctx.font.
 *
 * CSS font shorthand order (strict — wrong order silently falls back):
 *   [font-style] [font-weight] font-size font-family
 *   e.g. "italic bold 14px Georgia"
 *
 * This is a pure function — no state, no side effects, easy to test.
 */

export interface ParsedFont {
  style: string;   // "normal" | "italic" | "oblique"
  weight: string;  // "normal" | "bold" | "100".."900"
  size: string;    // "14px" | "12pt" etc.
  family: string;  // "Georgia" | "Times New Roman" etc.
}

/**
 * Parses a simple CSS font shorthand into its components.
 *
 * Handles the fonts we store in FontConfig:
 *   "14px Georgia"
 *   "bold 28px Georgia"
 *   "italic 14px Georgia"
 *   "italic bold 14px Georgia"
 *   "14px Times New Roman"   ← multi-word family
 */
export function parseFont(font: string): ParsedFont {
  const tokens = font.trim().split(/\s+/);

  let style = "normal";
  let weight = "normal";
  let sizeIndex = -1;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    if (token === "italic" || token === "oblique") {
      style = token;
    } else if (
      token === "bold" ||
      token === "bolder" ||
      token === "lighter" ||
      /^\d{3}$/.test(token)
    ) {
      weight = token;
    } else if (/^\d+(\.\d+)?(px|pt|em|rem|%)$/.test(token)) {
      sizeIndex = i;
      break;
    }
  }

  if (sizeIndex === -1) {
    return {
      style,
      weight,
      size: "14px",
      family: font.replace(/^['"]|['"]$/g, ""),
    };
  }

  const size = tokens[sizeIndex] ?? "14px";

  const rawFamily = tokens.slice(sizeIndex + 1).join(" ") || "serif";
  const family = rawFamily.replace(/^['"]|['"]$/g, "");

  return { style, weight, size, family };
}
/**
 * Reconstructs a canonical CSS font string from parsed components.
 *
 * Omits "normal" values to keep the string clean:
 *   { style: "normal", weight: "bold", size: "14px", family: "Georgia" }
 *   → "bold 14px Georgia"
 */
function buildFont(parsed: ParsedFont): string {
  const parts: string[] = [];
  if (parsed.style !== "normal") parts.push(parsed.style);
  if (parsed.weight !== "normal") parts.push(parsed.weight);
  parts.push(parsed.size);
  parts.push(parsed.family);
  return parts.join(" ");
}

/**
 * Returns a copy of `font` with the family replaced by `family`.
 * Weight, style, and size are preserved.
 *
 *   substituteFamily("bold 28px Georgia, serif", "Times New Roman")
 *   → "bold 28px Times New Roman"
 */
export function substituteFamily(font: string, family: string): string {
  return buildFont({ ...parseFont(font), family });
}

/**
 * Returns a font string with weight and style stripped — only size and family
 * remain. Used by the layout engine to measure vertical metrics (ascent/descent)
 * independent of bold/italic variants. This prevents bold or italic spans from
 * inflating line height while still allowing font-size changes to affect it.
 *
 *   "bold italic 14px Georgia" → "14px Georgia"
 *   "bold 28px Georgia, serif" → "28px Georgia, serif"
 */
export function normalizeFont(font: string): string {
  const p = parseFont(font);
  return `${p.size} ${p.family}`;
}

/**
 * Resolves the final font string for a text node given its ProseMirror marks.
 *
 * @param baseFont  — the font for this block type from FontConfig
 * @param marks     — the marks on this text node from ProseMirror
 * @param modifiers — optional map of mark name → FontModifier from extensions.
 *                    When a modifier is found for a mark, it is called instead
 *                    of the built-in switch fallback.
 */
export function resolveFont(
  baseFont: string,
  marks: readonly Mark[],
  modifiers?: Map<string, FontModifier>
): string {
  const parsed = parseFont(baseFont);

  for (const mark of marks) {
    const modifier = modifiers?.get(mark.type.name);
    if (modifier) {
      modifier(parsed, mark.attrs as Record<string, unknown>);
    } else {
      // Fallback for marks without a registered modifier
      switch (mark.type.name) {
        case "bold":        parsed.weight = "bold"; break;
        case "italic":      parsed.style = "italic"; break;
        case "font_size":   parsed.size = `${mark.attrs["size"] as number}px`; break;
        case "font_family": parsed.family = mark.attrs["family"] as string; break;
      }
    }
  }

  return buildFont(parsed);
}
