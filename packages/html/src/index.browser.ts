import { htmlImporter, type ImportHtml } from "./importHtml";
import { withPageBody } from "./dom";

/** Import an HTML document using the editor's schema, parsed by the page. */
export const importHtml: ImportHtml = htmlImporter(withPageBody);

export * from "./shared";
