/**
 * Export extensibility types. Core defines the empty `FormatHandlers`
 * interface and the `ExportContributionMap` type. Format packages augment
 * `FormatHandlers` via module augmentation — when `@scrivr/export-pdf`
 * is imported, `FormatHandlers.pdf` becomes a concrete type.
 *
 * Extensions declare `addExports()` to contribute format-specific handlers
 * as a map keyed by format name. This prevents duplicate-format entries per
 * extension and makes merging across extensions a simple Object.assign.
 *
 * The format packages' export functions collect contributions at runtime.
 */

/**
 * Augmented by format packages — empty in core.
 *
 * When no format package is loaded, `keyof FormatHandlers` is `never` and
 * `ExportContributionMap` resolves to `{}` — extensions can still declare
 * `addExports()` but the return type makes it impossible to add a key
 * without a format package imported (type-safe).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FormatHandlers {}

/**
 * Map of format → handler bundle. Extensions return this from `addExports()`.
 * Each key matches a `FormatHandlers` augmentation (e.g. "pdf", "markdown").
 * Partial so extensions only contribute to formats they care about.
 *
 * Example:
 * ```ts
 * addExports() {
 *   return {
 *     pdf: { nodes: { callout: drawCalloutPdf } },
 *     markdown: { nodes: { callout: serializeCalloutMd } },
 *   };
 * }
 * ```
 */
export type ExportContributionMap = {
  [F in keyof FormatHandlers]?: FormatHandlers[F];
};
