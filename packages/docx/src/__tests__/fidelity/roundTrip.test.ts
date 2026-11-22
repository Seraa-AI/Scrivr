import { it, expect } from "vitest";
import { exportDocxBytes } from "../../export/export";
import { FIXTURES, editorWith, importBytes, importFixture } from "./fixtures";
import { roundTripDifferences } from "./roundTrip";
import { gateKnown, publishSummary, type KnownDifferences } from "./scores";

/**
 * Import → export → re-import gives back the same document.
 *
 * The differences each fixture has today are stored as known
 * (`scores/roundTrip.json`). A new one — or one more of a known one — fails:
 * export and import have started to disagree about something they agreed on.
 */

it("brings every fixture back as it went out, apart from the known differences", { timeout: 60_000 }, async () => {
  const measured: KnownDifferences = {};
  const rows: string[][] = [];
  let sameTexts = 0;
  for (const fixture of FIXTURES) {
    const { doc } = await importFixture(fixture);
    const { doc: again } = await importBytes(await exportDocxBytes(editorWith(doc)));
    const diffs = roundTripDifferences(doc, again);
    const sameText = doc.textContent === again.textContent;
    measured[fixture.name] = diffs;
    if (sameText) sameTexts++;
    rows.push([fixture.name, sameText ? "yes" : "no", String(diffs.length)]);
  }
  const sameDocs = Object.values(measured).filter((diffs) => diffs.length === 0).length;
  rows.push(["**all**", `${sameTexts}/${FIXTURES.length}`, `${sameDocs}/${FIXTURES.length} unchanged`]);
  publishSummary("DOCX round trip", ["fixture", "same text", "block differences"], rows);

  expect(gateKnown("roundTrip", measured)).toEqual([]);
});
