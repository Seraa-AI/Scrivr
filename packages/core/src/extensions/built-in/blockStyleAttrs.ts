import { DEFAULT_FONT_PX, cssLengthToPx, cssPrimaryFamily } from "../../model/cssValues";
import { elementTextAlign } from "../../model/htmlElements";
import { INDENT_STEP } from "./Indent";

/** The text-block attributes an element's own style, or its `align`, states: paragraph, heading, div. */
export function blockStyleAttrs(el: HTMLElement) {
  const marginLeft = cssLengthToPx(el.style.marginLeft, DEFAULT_FONT_PX) ?? 0;
  const textIndent = cssLengthToPx(el.style.textIndent, DEFAULT_FONT_PX) ?? 0;
  return {
    align: elementTextAlign(el) ?? "left",
    indent: marginLeft > 0 ? Math.round(marginLeft / INDENT_STEP) : 0,
    textIndent: textIndent > 0 ? textIndent : 0,
    fontFamily: cssPrimaryFamily(el.style.fontFamily),
    nodeId: el.getAttribute("data-node-id") ?? null,
  };
}
