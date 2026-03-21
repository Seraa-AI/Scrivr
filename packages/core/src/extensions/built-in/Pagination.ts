import { Extension } from "../Extension";
import { defaultPageConfig } from "../../layout/PageLayout";
import type { PageConfig } from "../../layout/PageLayout";

/**
 * Pagination — declares the page dimensions and margins for the editor.
 *
 * The editor reads this extension's options as its PageConfig. Without this
 * extension (or when not included in StarterKit), the editor falls back to
 * EditorOptions.pageConfig, then to the built-in A4 defaultPageConfig.
 *
 * Usage:
 *   // Default A4 with 1-inch margins
 *   new Editor({ extensions: [StarterKit] })
 *
 *   // US Letter
 *   new Editor({
 *     extensions: [
 *       StarterKit.configure({ pagination: { pageWidth: 816, pageHeight: 1056, margins: { top: 72, right: 72, bottom: 72, left: 72 } } }),
 *     ],
 *   })
 *
 *   // Standalone (when not using StarterKit)
 *   new Editor({
 *     extensions: [Pagination.configure({ pageWidth: 595, pageHeight: 842, margins: { top: 56, right: 56, bottom: 56, left: 56 } })],
 *   })
 */
export const Pagination = Extension.create<PageConfig>({
  name: "pagination",
  defaultOptions: defaultPageConfig,
});
