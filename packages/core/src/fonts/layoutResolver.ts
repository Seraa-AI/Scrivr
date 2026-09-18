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

/**
 * The face a CSS font-family list is actually asking for.
 *
 * `parseFont` hands back everything after the size, so "Arial, sans-serif"
 * arrives as one family name and matches nothing an application registered
 * under "Arial". The rest of the list is the host's fallback chain, which is
 * the decision a provider exists to make instead.
 */
export const primaryFamily = (family: string): string => {
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let end = family.length;

  for (let i = 0; i < family.length; i++) {
    const char = family[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === ",") {
      end = i;
      break;
    }
  }

  const first = family.slice(0, end).trim();
  const unquoted =
    first.length >= 2 &&
    ((first.startsWith('"') && first.endsWith('"')) ||
      (first.startsWith("'") && first.endsWith("'")))
      ? first.slice(1, -1)
      : first;
  return unquoted.replace(/\\(.)/g, "$1") || family;
};

/** Weight and slant as the CSS shorthand spells them, in the terms a key uses. */
function requestFrom(cssFont: string, size: number) {
  const parsed = parseFont(cssFont);
  return {
    family: primaryFamily(parsed.family),
    weight: /^\d+$/.test(parsed.weight) ? Number(parsed.weight) : parsed.weight === "bold" ? 700 : 400,
    style: parsed.style === "italic" || parsed.style === "oblique" ? ("italic" as const) : ("normal" as const),
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
  const idByFace = new Map<string, FontResolutionId>();

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
      // Identity is the face, not the family. Bold and regular Arial resolve
      // to one family name and two sets of bytes; interning on the name alone
      // would hand an exporter one id for both and let it embed the wrong
      // weight for half the document.
      // Encoded rather than joined on a separator: a resource id is whatever
      // the application called it, so it can contain the separator, and its
      // absence has to stay distinguishable from an id that happens to be "".
      const { weight, style } = resolution.request;
      const key = JSON.stringify([
        resolution.resource?.id ?? null,
        family,
        resolution.resolved.source,
        resolution.resolved.portable,
        // The requested family is part of the identity even when two requests
        // share an answer today: registering one of them later must split them
        // rather than silently re-point both. Size is not — it is a
        // measurement parameter, and every size of a face has one answer.
        resolution.request.family,
        resolution.request.stretch,
        weight,
        style,
      ]);
      let id = idByFace.get(key);
      if (id === undefined) {
        id = byId.size;
        idByFace.set(key, id);
        byId.set(id, resolution);
      }

      // Measure what was resolved, not what was asked for. Quoted when the
      // name needs it: an invalid shorthand is silently ignored by `ctx.font`,
      // which leaves the previous span's face and produces geometry from a
      // font nobody chose.
      // Measure under the backend's own name for the bytes when it has one;
      // the family otherwise.
      //
      // The shorthand spells the resource's weight and slant, not the
      // request's. That is this renderer declining the synthesis the
      // resolution records — asking the host for a bold it does not have makes
      // the browser fake one, which widens every advance, while the PDF's
      // equivalent does not. Until both lanes position glyphs from the same
      // measurements, faking on one side is a disagreement about where the
      // next character goes.
      const face = resolution.resource;
      const measured = resolution.measuredAs ?? family;
      const font = face
        ? `${face.style === "italic" ? "italic " : ""}${face.weight === 400 ? "" : `${face.weight} `}${parsed.size} ${quoted(measured)}`
        : substituteFamily(cssFont, quoted(measured));
      const answer = { font, resolution: id };
      byFont.set(cssFont, answer);
      return answer;
    },
    table: () => byId,
  };
}
