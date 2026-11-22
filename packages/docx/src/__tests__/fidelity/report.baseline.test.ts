import { describe, it, expect } from "vitest";
import { exportDocx } from "../../export/export";
import { FIXTURES, editorWith, importFixture } from "./fixtures";
import { serializeReports } from "./reportLog";

/**
 * What each fixture's import and export report today, snapshotted.
 *
 * The report is what an app tells its user about their file, so a change that
 * makes an extension keep or drop something different must show up as a
 * reviewed diff here. The snapshots record today's behaviour, losses
 * included: a fix changes them, and that diff is the fix's evidence.
 */

describe.each(FIXTURES)("report — $name", (fixture) => {
  it("matches the recorded import and export reports", async () => {
    const imported = await importFixture(fixture);
    const exported = await exportDocx(editorWith(imported.doc));
    await expect(serializeReports(imported.report, exported.report)).toMatchFileSnapshot(
      `__snapshots__/report/${fixture.name}.json`,
    );
  });
});
