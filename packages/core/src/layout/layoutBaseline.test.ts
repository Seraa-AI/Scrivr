/**
 * What layout puts where for every oracle document, snapshotted. Laid out with
 * fixed-width glyphs, so it moves only when a layout decision does, and is the
 * same on every machine.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import { normalizeDrawNumber } from "../exports/drawNumber";
import { fixedWidths, FLOATING, FLOWING, SETUPS, whole } from "../test/layoutOracle";
import type { LayoutBlock } from "./BlockLayout";

const n = normalizeDrawNumber;

const blockLog = (block: LayoutBlock, indent: string): string[] => [
  `${indent}${block.blockType} x=${n(block.x)} y=${n(block.y)} w=${n(block.width)} h=${n(block.height)}${block.isContinuation ? " continued" : ""}${block.continuesOnNextPage ? " continues" : ""}`,
  ...block.lines.map((line) => {
    const first = line.spans[0];
    const shown = line.spans.map((span) => (span.kind === "text" ? span.text : "□")).join("");
    return `${indent}  | ${n(line.lineHeight)} @${n(first?.x ?? 0)} ${JSON.stringify(shown.slice(0, 24))}`;
  }),
  ...(block.regions ?? []).flatMap((region) => [
    `${indent}  region x=${n(region.x)} w=${n(region.width)} h=${n(region.height)}`,
    ...(region.floats ?? []).map((float) => `${indent}    float x=${n(float.x)} y=${n(float.y)} ${n(float.width)}×${n(float.height)}`),
    ...region.blocks.flatMap((inner) => blockLog(inner, `${indent}    `)),
  ]),
];

const logOf = (node: Node): string =>
  Object.entries(SETUPS).flatMap(([name, setup]) => {
    const layout = whole(node, { ...setup, measurer: fixedWidths });
    return [
      `## ${name}, ${n(layout.totalContentHeight)} tall`,
      ...layout.pages.flatMap((page) => [`page ${page.pageNumber}`, ...page.blocks.flatMap((block) => blockLog(block, "  "))]),
      ...(layout.anchoredObjects ?? []).map((float) => `float page=${float.page} x=${n(float.x)} y=${n(float.y)} ${n(float.width)}×${n(float.height)} ${float.wrapMode}`),
    ];
  }).join("\n");

const fileName = (name: string): string => name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

describe.each(Object.entries({ ...FLOWING, ...FLOATING }))("the layout of %s", (name, node) => {
  it("is the recorded one", async () => {
    await expect(`${logOf(node)}\n`).toMatchFileSnapshot(`__snapshots__/layout/${fileName(name)}.txt`);
  });
});
