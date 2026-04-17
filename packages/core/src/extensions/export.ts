/**
 * Export extensibility types. Core defines the empty `FormatHandlers`
 * interface and `ExportContribution` union. Format packages augment
 * `FormatHandlers` via module augmentation — when `@scrivr/export-pdf`
 * is imported, `FormatHandlers.pdf` becomes a concrete type and the
 * `ExportContribution` union includes `{ format: "pdf"; handlers: PdfHandlers }`.
 *
 * Extensions declare `addExports()` to contribute format-specific handlers.
 * The format packages' export functions collect them at runtime.
 */

/**
 * Augmented by format packages — empty in core.
 *
 * When no format package is loaded, `keyof FormatHandlers` is `never` and
 * `ExportContribution` resolves to `never` — extensions can still declare
 * `addExports()` but the return type makes it impossible to construct a
 * contribution without a format package imported (type-safe).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FormatHandlers {}

/**
 * A format-tagged contribution. Extensions return these from `addExports()`.
 * Each entry declares a format key (matching a `FormatHandlers` augmentation)
 * and the handler bundle for that format.
 */
export type ExportContribution = {
  [F in keyof FormatHandlers]: {
    format: F;
    handlers: FormatHandlers[F];
  };
}[keyof FormatHandlers];
