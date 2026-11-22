import { it, expect } from "vitest";
import { defaultPageConfig, type PageConfig } from "@scrivr/core";
import { FIXTURES, editorWith, importFixture } from "./fixtures";
import { layOut, pageTexts, pinnedFaceMeasurer } from "./layoutLog";
import { nonBlankCount, pageStartKey, readWordReference, type WordPageSetup } from "./wordReference";
import { formatScore, gate, publishSummary, type Fraction, type ScoreTable } from "./scores";

/**
 * Scrivr's layout of each fixture against what Word recorded in the file.
 *
 * Real glyph metrics, unlike the layout baseline, in one pinned face so the
 * scores are the same on every machine. Each fixture is laid out on the page
 * Word set — import does not carry it yet — so page starts measure where
 * layout breaks pages, not the page size. They are scored, not required: they
 * are where Word broke the pages when the file was last saved, in faces CI
 * does not have. Scores are stored in `scores/wordComparison.json`; a drop
 * fails.
 */

it("lays the fixtures out no further from Word than recorded", { timeout: 60_000 }, async () => {
  const measured: ScoreTable = {};
  const rows: string[][] = [];
  const totals = { samePages: 0, startsMatched: 0, starts: 0, allTextImported: 0, allTextOnPage: 0 };

  for (const fixture of FIXTURES) {
    const word = readWordReference(fixture.bytes);
    const { doc } = await importFixture(fixture);
    const layout = layOut(editorWith(doc), pinnedFaceMeasurer(), word.page ? onWordPage(word.page) : defaultPageConfig);
    const texts = pageTexts(layout);

    const scrivrStarts = new Set(texts.slice(1).map(pageStartKey));
    const pageStarts: Fraction = [word.pageStarts.filter((key) => scrivrStarts.has(key)).length, word.pageStarts.length];
    const imported = nonBlankCount(doc.textContent);
    const onPage = nonBlankCount(texts.join(""));
    // Capped at the whole: text beyond Word's — a text box read twice — is no
    // gain, and shows in the layout snapshot rather than here.
    const textImported: Fraction = [Math.min(imported, word.textChars), word.textChars];
    const textOnPage: Fraction = [Math.min(onPage, imported), imported];

    measured[fixture.name] = { pageStarts, textImported, textOnPage };

    if (word.pages === layout.pages.length) totals.samePages++;
    totals.startsMatched += pageStarts[0];
    totals.starts += pageStarts[1];
    if (imported >= word.textChars) totals.allTextImported++;
    if (onPage >= imported) totals.allTextOnPage++;
    rows.push([
      fixture.name,
      `${layout.pages.length} / ${word.pages ?? "—"}`,
      formatScore(pageStarts),
      formatScore(textImported),
      formatScore(textOnPage),
    ]);
  }

  const n = FIXTURES.length;
  rows.push([
    "**all**",
    `${totals.samePages}/${n} same count`,
    `${totals.startsMatched}/${totals.starts}`,
    `${totals.allTextImported}/${n} complete`,
    `${totals.allTextOnPage}/${n} complete`,
  ]);
  publishSummary(
    "DOCX layout against Word",
    ["fixture", "pages (Scrivr / Word)", "page starts matched", "text imported", "imported text on a page"],
    rows,
  );

  expect(gate("wordComparison", measured)).toEqual([]);
});

/** The page Word set, as the layout takes one. */
function onWordPage(word: WordPageSetup): PageConfig {
  return { ...defaultPageConfig, pageWidth: word.width, pageHeight: word.height, margins: word.margins };
}
