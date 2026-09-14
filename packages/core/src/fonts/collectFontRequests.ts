import type { Node as PmNode } from "prosemirror-model";
import type { FontKey, FontProvider, FontRequest } from "./types";

/** A face whose answer is worth telling somebody about. */
export interface FontShortfall {
  request: FontKey;
  /** What it resolved to. */
  resolved: string;
  /** How that answer was reached, unchanged from the resolution. */
  source: "requested" | "substituted" | "default" | "generic";
  /** False when the answer only holds in this environment. */
  portable: boolean;
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
    const { resolved } = provider.resolve(request, constraints);
    // The face asked for, portably: nothing to say.
    if (resolved.source === "requested" && resolved.portable) continue;
    shortfalls.push({
      request,
      resolved: resolved.family,
      source: resolved.source,
      portable: resolved.portable,
    });
  }
  return shortfalls;
}
