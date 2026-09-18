import type { Node as PmNode } from "prosemirror-model";
import type { DocumentLayout } from "../layout/PageLayout";
import type { LayoutBlock } from "../layout/BlockLayout";
import type { FontResolutionId } from "./layoutResolver";
import type {
  FontKey,
  FontProvider,
  FontRequest,
  FontResolution,
  FontSynthesis,
} from "./types";

/** A face whose answer is worth telling somebody about. */
export interface FontShortfall {
  request: FontKey;
  /**
   * The face that answered, as a whole key rather than a family name.
   *
   * A family alone cannot say what was lost. An inventory holding one weight
   * of a family answers a request for its bold with its regular, and Scrivr
   * does not synthesize one — so the only difference between "your document is
   * in a different typeface" and "your headings are no longer bold" is the
   * weight and style, and reporting the family throws both away.
   */
  resolved: FontKey;
  /** What the chosen face does not supply, when it supplies less than was asked. */
  synthesis?: FontSynthesis;
  /** How that answer was reached, unchanged from the resolution. */
  source: "requested" | "substituted" | "default" | "generic";
  /** False when the answer only holds in this environment. */
  portable: boolean;
}

/**
 * The resolutions a laid-out document actually draws with.
 *
 * A resolver's table accumulates for the life of the coordinator so ids on
 * cached spans stay resolvable, which means it holds every face the session
 * ever asked for — a family the user tried in a picker and abandoned is still
 * in it. A consumer describing the document, or acquiring bytes for it, wants
 * the faces on the page.
 */
export function usedResolutions(layout: DocumentLayout): Set<FontResolutionId> {
  const used = new Set<FontResolutionId>();
  const visitBlocks = (blocks: readonly LayoutBlock[]): void => {
    for (const block of blocks) {
      for (const line of block.lines) {
        for (const span of line.spans) {
          if (span.resolution !== undefined) used.add(span.resolution);
        }
      }
      for (const cell of block.cells ?? []) visitBlocks(cell.blocks);
    }
  };
  for (const page of layout.pages) visitBlocks(page.blocks);
  return used;
}

/**
 * The physical face an answer landed on.
 *
 * A resource is that face. An answer without one never reached a physical
 * face — the host will decide the whole appearance — so the request's own
 * weight and slant are the only honest description of what it will be drawn
 * at.
 */
export function resolvedKeyOf(answer: FontResolution): FontKey {
  const { resource, request, resolved } = answer;
  if (resource) {
    const { family, weight, style, stretch } = resource;
    return { family, weight, style, ...(stretch ? { stretch } : {}) };
  }
  return {
    family: resolved.family,
    weight: request.weight,
    style: request.style,
    ...(request.stretch ? { stretch: request.stretch } : {}),
  };
}

const keyOf = (key: FontKey): string =>
  `${key.family.toLowerCase()}|${key.weight}|${key.style}`;

/**
 * Every distinct face a document asks for.
 *
 * A document names a handful of faces and repeats them across thousands of
 * runs, so this is the whole question the provider has to answer before
 * anything is measured — it is small, and it is knowable without measuring.
 *
 * Text nobody styled is not absent from the list: it carries the document's
 * default, which is a request like any other.
 */
export function collectFontRequests(
  doc: PmNode,
  fallback: FontRequest,
): FontRequest[] {
  const found = new Map<string, FontRequest>();
  const add = (family: unknown, weight: number, style: "normal" | "italic") => {
    if (typeof family !== "string" || family.length === 0) return;
    const request: FontRequest = { family, weight, style, size: fallback.size };
    found.set(keyOf(request), request);
  };

  doc.descendants((node) => {
    if (!node.isText) return;
    const bold = node.marks.some((m) => m.type.name === "bold");
    const italic = node.marks.some((m) => m.type.name === "italic");
    const weight = bold ? 700 : 400;
    const style = italic ? "italic" : "normal";

    const mark = node.marks.find((m) => m.type.name === "fontFamily");
    if (mark) add(mark.attrs["family"], weight, style);
    else add(fallback.family, weight, style);
  });

  doc.descendants((node) => {
    if (node.isText) return;
    add(node.attrs["fontFamily"], 400, "normal");
  });

  // A document of nothing but unstyled text still needs its default resolved.
  if (found.size === 0) found.set(keyOf(fallback), fallback);
  return [...found.values()];
}

/**
 * Resolve everything a document asks for, and report what it did not get.
 *
 * Acquires the bytes as well as reporting, so a later layout can measure
 * against them. The reporting is the part a caller acts on: a document whose
 * typography could not be honoured stops being silent about it.
 */
export async function prepareDocumentFonts(
  doc: PmNode,
  provider: FontProvider,
  constraints?: Parameters<FontProvider["resolve"]>[1],
): Promise<FontShortfall[]> {
  const requests = collectFontRequests(doc, provider.defaultRequest());
  await provider.prepare(requests, constraints);

  const shortfalls: FontShortfall[] = [];
  for (const request of requests) {
    const answer = provider.resolve(request, constraints);
    const { resolved } = answer;
    // The face asked for, portably: nothing to say.
    if (resolved.source === "requested" && resolved.portable) continue;
    shortfalls.push({
      request,
      resolved: resolvedKeyOf(answer),
      ...(answer.synthesis ? { synthesis: answer.synthesis } : {}),
      source: resolved.source,
      portable: resolved.portable,
    });
  }
  return shortfalls;
}
