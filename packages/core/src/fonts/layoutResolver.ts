import { parseFont, substituteFamily } from "../layout/StyleResolver";
import type { FontProvider, FontResolution, FontResolutionConstraints } from "./types";

/** Identifies one resolution within a layout. Opaque: the table owns the shape. */
export type FontResolutionId = number;

/**
 * What layout asks when it is about to measure a span.
 *
 * Layout knows a CSS font string and nothing about fonts. It hands that over
 * and gets back the string to actually measure with — the resolved family
 * substituted in — plus an id naming the answer. Measuring the requested
 * family and recording the resolved one would be the same lie this exists to
 * remove, one layer in.
 */
export interface LayoutFontResolver {
  resolve(cssFont: string): { font: string; resolution: FontResolutionId };
  /** Every answer this layout used, for a consumer that must reproduce it. */
  table(): ReadonlyMap<FontResolutionId, FontResolution>;
}

/** A family name is bare only while every part is a CSS identifier. */
const BARE_FAMILY = /^[A-Za-z_-][\w-]*(?: [A-Za-z_-][\w-]*)*$/;

const quoted = (family: string): string =>
  BARE_FAMILY.test(family) ? family : `"${family.replace(/"/g, '\\"')}"`;

/** Weight and slant as the CSS shorthand spells them, in the terms a key uses. */
function requestFrom(cssFont: string, size: number) {
  const parsed = parseFont(cssFont);
  const lower = cssFont.toLowerCase();
  return {
    family: parsed.family,
    weight: /bold|[789]\d\d/.test(lower) ? 700 : 400,
    style: /italic|oblique/.test(lower) ? ("italic" as const) : ("normal" as const),
    size,
  };
}

/**
 * Binds a provider to one layout run.
 *
 * Answers are cached per font string because a document repeats a handful of
 * them across thousands of spans, and interned because the consumer that has
 * to reproduce this geometry wants the answer once, not per run.
 */
export function createLayoutFontResolver(
  provider: FontProvider,
  constraints?: FontResolutionConstraints,
): LayoutFontResolver {
  const byFont = new Map<string, { font: string; resolution: FontResolutionId }>();
  const byId = new Map<FontResolutionId, FontResolution>();
  const idByFamily = new Map<string, FontResolutionId>();

  return {
    resolve(cssFont) {
      const cached = byFont.get(cssFont);
      if (cached) return cached;

      const parsed = parseFont(cssFont);
      const resolution = provider.resolve(
        requestFrom(cssFont, Number.parseFloat(parsed.size) || 14),
        constraints,
      );

      const family = resolution.resolved.family;
      const key = `${family}|${resolution.resolved.source}|${resolution.resolved.portable}`;
      let id = idByFamily.get(key);
      if (id === undefined) {
        id = byId.size;
        idByFamily.set(key, id);
        byId.set(id, resolution);
      }

      // Measure what was resolved, not what was asked for. Quoted when the
      // name needs it: an invalid shorthand is silently ignored by `ctx.font`,
      // which leaves the previous span's face and produces geometry from a
      // font nobody chose.
      const answer = { font: substituteFamily(cssFont, quoted(family)), resolution: id };
      byFont.set(cssFont, answer);
      return answer;
    },
    table: () => byId,
  };
}
