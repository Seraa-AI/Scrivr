import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stored results, one file per check under `scores/`, in two shapes:
 *
 * - a score table — per fixture, per metric, a fraction — for the edited
 *   export and the Word comparison;
 * - known differences — per fixture, a list of labels — for the round trip.
 *
 * A known gap does not fail the build. A score below its stored value, or a
 * difference not on the stored list, is a regression and fails. A score that
 * rises, or a known difference that is gone, is logged, and fails in CI until
 * the change that caused it records the new value by running the suite with
 * `UPDATE_FIDELITY_SCORES=1` — otherwise a later change could fall back to the
 * old value unnoticed. The diff to the stored file is the evidence a reviewer
 * reads.
 */

const SCORES_DIR = join(dirname(fileURLToPath(import.meta.url)), "scores");
const UPDATING = process.env["UPDATE_FIDELITY_SCORES"] === "1";

/** A count out of a total: `[3, 10]` is three of ten. */
export type Fraction = [number, number];

/** Per fixture, per metric. */
export type ScoreTable = Record<string, Record<string, Fraction>>;

/** Per fixture, the differences already known. A label can appear more than once. */
export type KnownDifferences = Record<string, string[]>;

interface Verdict {
  regressions: string[];
  improvements: string[];
}

/** Record or check a score table. Returns what regressed. */
export function gate(check: string, measured: ScoreTable): string[] {
  return settle(check, measured, () => judge(read(check, isScoreTable), measured));
}

/** Record or check known differences. Returns what is new. */
export function gateKnown(check: string, measured: KnownDifferences): string[] {
  const kept = Object.fromEntries(Object.entries(measured).filter(([, diffs]) => diffs.length > 0));
  return settle(check, kept, () => judgeKnown(read(check, isKnownDifferences), measured));
}

/**
 * Compare measured scores with the stored ones. A fixture or metric with no
 * stored value is a regression — a score nobody recorded guards nothing — and
 * so is a stored one the run no longer measures, which would otherwise drop
 * its guard silently.
 */
export function judge(stored: ScoreTable, measured: ScoreTable): Verdict {
  const regressions: string[] = [];
  const improvements: string[] = [];
  for (const [fixture, metrics] of Object.entries(measured)) {
    for (const [metric, value] of Object.entries(metrics)) {
      const before = stored[fixture]?.[metric];
      const label = `${fixture} ${metric}: ${formatScore(before)} → ${formatScore(value)}`;
      if (before === undefined) regressions.push(`${label} (not recorded)`);
      else if (ratio(value) < ratio(before)) regressions.push(label);
      else if (ratio(value) > ratio(before)) improvements.push(label);
    }
  }
  for (const [fixture, metrics] of Object.entries(stored)) {
    for (const metric of Object.keys(metrics)) {
      if (measured[fixture]?.[metric] === undefined) regressions.push(`${fixture} ${metric}: no longer measured`);
    }
  }
  return { regressions, improvements };
}

/**
 * Compare differences by how often each label occurs, not only whether it
 * does: a second empty paragraph that changed is a new difference even when
 * one already was.
 */
export function judgeKnown(stored: KnownDifferences, measured: KnownDifferences): Verdict {
  const regressions: string[] = [];
  const improvements: string[] = [];
  const fixtures = new Set([...Object.keys(stored), ...Object.keys(measured)]);
  for (const fixture of fixtures) {
    const before = tally(stored[fixture] ?? []);
    const now = tally(measured[fixture] ?? []);
    for (const [diff, count] of now) {
      const known = before.get(diff) ?? 0;
      if (count > known) regressions.push(`${fixture}: ${diff}${count > 1 ? ` (×${count}, ${known} known)` : ""}`);
    }
    for (const [diff, count] of before) {
      if ((now.get(diff) ?? 0) < count) improvements.push(`${fixture}: ${diff}`);
    }
  }
  return { regressions, improvements };
}

/** Write the measured results when recording; otherwise judge them and log what improved. */
function settle(check: string, measured: object, verdict: () => Verdict): string[] {
  if (UPDATING) {
    mkdirSync(SCORES_DIR, { recursive: true });
    // Code-unit order, the order the fixtures load in, on every machine.
    const sorted = Object.fromEntries(Object.entries(measured).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    writeFileSync(join(SCORES_DIR, `${check}.json`), `${JSON.stringify(sorted, null, 2)}\n`);
    return [];
  }
  return failures(check, verdict(), process.env["CI"] === "true");
}

/**
 * What fails a check: every regression, and in CI an improvement nobody
 * recorded — left in place, a later change could fall back to the old value
 * and pass. Locally an improvement is only logged, so it can be seen first.
 */
export function failures(check: string, { regressions, improvements }: Verdict, inCI: boolean): string[] {
  if (improvements.length === 0) return regressions;
  // Run in the package: turbo does not pass UPDATE_FIDELITY_SCORES through `pnpm test`.
  const message = `${check} improved — record it from packages/docx with \`UPDATE_FIDELITY_SCORES=1 npx vitest run src/__tests__/fidelity\`:\n  ${improvements.join("\n  ")}`;
  console.info(`[fidelity] ${message}`);
  return inCI ? [...regressions, `unrecorded: ${message}`] : regressions;
}

/** A stored file, or nothing when it is missing or has the wrong shape — so every result reads as not recorded. */
function read<T>(check: string, guard: (value: unknown) => value is T): T | Record<string, never> {
  const file = join(SCORES_DIR, `${check}.json`);
  if (!existsSync(file)) return {};
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return guard(parsed) ? parsed : {};
}

/**
 * Write a markdown table to the CI run's summary page when GitHub Actions
 * provides one, and to the test log always.
 */
export function publishSummary(title: string, header: readonly string[], rows: readonly string[][]): void {
  const markdown = [
    `### ${title}`,
    "",
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n");
  console.info(markdown);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary) appendFileSync(summary, `${markdown}\n`);
}

export function formatScore(value: Fraction | undefined): string {
  if (value === undefined) return "—";
  return `${value[0]}/${value[1]}`;
}

function ratio(value: Fraction): number {
  // Nothing to measure counts as complete, so an empty total can never regress.
  return value[1] === 0 ? 1 : value[0] / value[1];
}

function tally(diffs: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diff of diffs) counts.set(diff, (counts.get(diff) ?? 0) + 1);
  return counts;
}

function isScoreTable(value: unknown): value is ScoreTable {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(
    (metrics) =>
      typeof metrics === "object" &&
      metrics !== null &&
      Object.values(metrics).every(
        (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number"),
      ),
  );
}

function isKnownDifferences(value: unknown): value is KnownDifferences {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((v) => Array.isArray(v) && v.every((d) => typeof d === "string"));
}
