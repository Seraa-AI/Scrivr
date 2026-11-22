// Kept out of `docx.ts`, which core re-exports whole: this is for core's own handlers.
import { parseCssColor } from "../model/cssColor";
import { cssColorToDocxHex, type DocxReporter } from "./docx";

/**
 * A colour as a DOCX export writes it — six hex digits — or null when it is
 * not one. DOCX has no alpha, so a translucent colour is blended onto the
 * white page, and the blend is reported under `kind`.
 */
export function writtenDocxColor(value: string, kind: string, what: string, report: DocxReporter): string | null {
  const hex = cssColorToDocxHex(value);
  const alpha = parseCssColor(value.trim())?.alpha ?? 1;
  if (hex !== null && alpha < 1) report.changed(kind, `translucent ${what} blended onto white`);
  return hex;
}
