import { cssLengthToPx, cssPrimaryFamily, cssTextAlign } from "../../model/cssValues";
import { INDENT_STEP } from "./Indent";

/** The text-block attributes an element's own style states: paragraph, heading, div. */
export function blockStyleAttrs(el: HTMLElement) {
  const marginLeft = cssLengthToPx(el.style.marginLeft) ?? 0;
  const textIndent = cssLengthToPx(el.style.textIndent) ?? 0;
  return {
    align: cssTextAlign(el.style.textAlign),
    indent: marginLeft > 0 ? Math.round(marginLeft / INDENT_STEP) : 0,
    textIndent: textIndent > 0 ? textIndent : 0,
    fontFamily: cssPrimaryFamily(el.style.fontFamily),
    nodeId: el.getAttribute("data-node-id") ?? null,
  };
}
