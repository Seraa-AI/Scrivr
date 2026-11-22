// Its own module so the `HtmlImport` extension can use it without importing happy-dom.
import { withPageBody } from "./dom";
import { htmlImporter, type ImportHtml } from "./importHtml";

/**
 * Import an HTML document using the editor's schema; {@link ImportHtml} has
 * what it reports and how ids are kept. Parsed by the page's own `DOMParser`:
 * this is the entry browser bundlers resolve.
 */
export const importHtml: ImportHtml = htmlImporter(withPageBody);
