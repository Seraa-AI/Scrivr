import { htmlImporter, type ImportHtml } from "./importHtml";
import { withServerBody } from "./domServer";

/** Import an HTML document using the editor's schema, parsed with happy-dom. */
export const importHtml: ImportHtml = htmlImporter(withServerBody);

export * from "./shared";
