import { htmlImporter, type ImportHtml } from "./importHtml";
import { withServerBody } from "./domServer";

/**
 * Import an HTML document using the editor's schema; {@link ImportHtml} has
 * what it reports and how ids are kept. Parsed with happy-dom: this is the
 * entry Node resolves.
 */
export const importHtml: ImportHtml = htmlImporter(withServerBody);

export * from "./shared";
