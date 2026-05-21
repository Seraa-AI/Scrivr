/**
 * No built-in handlers live in `@scrivr/export-docx`.
 *
 * Every node + mark contributes its DOCX export shape via the owning
 * extension's `addExports().docx`. The export pipeline aggregates from
 * `editor.getExportContributions()` plus per-call overrides — no defaults
 * layer in the format package.
 *
 * Kept as a tombstone export so any consumer that imported the constants
 * still type-checks against the empty maps.
 */

import type { DocxNodeHandler, DocxMarkHandler } from "./handlers";

export const defaultDocxNodeHandlers: Record<string, DocxNodeHandler> = {};
export const defaultDocxMarkHandlers: Record<string, DocxMarkHandler> = {};
