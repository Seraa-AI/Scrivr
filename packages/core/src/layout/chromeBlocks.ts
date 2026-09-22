/**
 * Every block a layout's chrome paints.
 *
 * A chrome payload is opaque to core — the extension that produced it owns its
 * shape — but a slot carrying a mini-layout carries it under `slots.*.layout`.
 * Anything that has to account for the whole page rather than just the body,
 * such as which faces to embed or which images to fetch, has to see these
 * blocks too; a lane that walks only `layout.pages` silently omits whatever
 * appears exclusively in a header or footer.
 *
 * Read structurally, so a payload that carries no layout is simply not chrome
 * with blocks rather than an error.
 */
import type { LayoutBlock } from "./BlockLayout";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function chromeBlocks(
  payloads: Record<string, unknown> | undefined,
): readonly LayoutBlock[] {
  if (!payloads) return [];
  const blocks: LayoutBlock[] = [];
  for (const payload of Object.values(payloads)) {
    if (!isRecord(payload) || !isRecord(payload["slots"])) continue;
    for (const slot of Object.values(payload["slots"])) {
      if (!isRecord(slot) || !isRecord(slot["layout"])) continue;
      const pages = slot["layout"]["pages"];
      if (!Array.isArray(pages)) continue;
      for (const page of pages) {
        if (!isRecord(page) || !Array.isArray(page["blocks"])) continue;
        // Shape checked above; the element type is core's own.
        blocks.push(...(page["blocks"] as LayoutBlock[]));
      }
    }
  }
  return blocks;
}
