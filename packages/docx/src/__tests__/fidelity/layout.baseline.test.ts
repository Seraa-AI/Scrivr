import { describe, it, expect } from "vitest";
import { FIXTURES, editorWith, importFixture } from "./fixtures";
import { fixedWidthMeasurer, layOut, recordLayout, serializeLayout } from "./layoutLog";

/**
 * What Scrivr puts on each page of each fixture, snapshotted.
 *
 * Laid out with fixed-width glyphs, so the log moves only when a layout
 * decision does — spacing, page geometry, where a block splits or a line
 * breaks — and is the same on every machine.
 */

describe.each(FIXTURES)("layout — $name", (fixture) => {
  it("matches the recorded layout log", async () => {
    const { doc } = await importFixture(fixture);
    const ops = recordLayout(layOut(editorWith(doc), fixedWidthMeasurer()));
    await expect(serializeLayout(ops)).toMatchFileSnapshot(`__snapshots__/layout/${fixture.name}.jsonl`);
  });
});
