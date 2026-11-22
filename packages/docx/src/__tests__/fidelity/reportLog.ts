import type { DocxReport } from "@scrivr/core";

/**
 * A fixture's import and export reports as the baseline stores them. The
 * mutation tests perturb a report and require this form to change, so both
 * must go through this one function.
 */
export function serializeReports(imported: DocxReport, exported: DocxReport): string {
  return `${JSON.stringify({ import: imported, export: exported }, null, 2)}\n`;
}
