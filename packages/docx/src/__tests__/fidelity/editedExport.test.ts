import { it, expect } from "vitest";
import { exportDocxBytes } from "../../export/export";
import { FIXTURES, importFixture } from "./fixtures";
import { ScriptedEditor, applyScriptedEdits, scoreEditedExport } from "./editedExport";
import { paragraphsOfDocx } from "./wordReference";
import { gate, publishSummary, show, type ScoreTable } from "./scores";

/**
 * Edit each fixture the way a user would, export it, and count what the edits
 * did not touch that still matches the original, and which edits took the
 * formatting around them. Stored in `scores/editedExport.json`; a drop fails.
 */

it("keeps what the edits did not touch as Word had it, no worse than recorded", { timeout: 60_000 }, async () => {
  const measured: ScoreTable = {};
  const rows: string[][] = [];
  for (const fixture of FIXTURES) {
    const { doc } = await importFixture(fixture);
    const editor = new ScriptedEditor(doc);
    const bold = applyScriptedEdits(editor);
    const exported = await exportDocxBytes(editor);
    const scores = scoreEditedExport(paragraphsOfDocx(fixture.bytes), paragraphsOfDocx(exported), bold);
    measured[fixture.name] = { untouched: scores.untouched, edits: scores.edits };
    rows.push([fixture.name, show(scores.untouched), show(scores.edits)]);
  }
  publishSummary("DOCX edited export", ["fixture", "untouched paragraphs preserved", "edits matching"], rows);

  expect(gate("editedExport", measured)).toEqual([]);
});
