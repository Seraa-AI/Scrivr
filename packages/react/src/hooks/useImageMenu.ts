import { useEffect, useState } from "react";
import { createImageMenu } from "@scrivr/core";
import type { Editor, ImageMenuInfo } from "@scrivr/core";
import { useFloatingPosition } from "./useFloatingPosition";

export type ImageVerticalAlign =
  | "baseline"
  | "middle"
  | "top"
  | "bottom"
  | "text-top"
  | "text-bottom";
export type ImageWrappingMode =
  | "inline"
  | "square"
  | "top-bottom"
  | "behind"
  | "front";

const ALIGN_OPTIONS: { value: ImageVerticalAlign; label: string; title: string }[] =
  [
    { value: "baseline", label: "Baseline", title: "Align image bottom to text baseline" },
    { value: "middle", label: "Middle", title: "Center image on font x-height (matches Word / Docs)" },
    { value: "top", label: "Top", title: "Align image top to line top" },
    { value: "bottom", label: "Bottom", title: "Align image bottom to line bottom" },
    { value: "text-top", label: "Text Top", title: "Align image top to parent font ascent" },
    { value: "text-bottom", label: "Text Bot", title: "Align image bottom to parent font descent" },
  ];

const WRAP_OPTIONS: { value: ImageWrappingMode; label: string; title: string }[] = [
  { value: "inline", label: "In line", title: "Image sits inline with text" },
  { value: "square", label: "Wrap", title: "Text wraps around all sides of the image" },
  { value: "top-bottom", label: "↕ Break", title: "Image breaks the text flow (top/bottom)" },
  { value: "behind", label: "Behind", title: "Image floats behind text" },
  { value: "front", label: "Front", title: "Image floats in front of text" },
];

export function useImageMenu(editor: Editor | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [info, setInfo] = useState<ImageMenuInfo | null>(null);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [wrappingMode, setWrappingMode] =
    useState<ImageWrappingMode>("inline");
  const { ref, position } = useFloatingPosition<HTMLDivElement>(rect);

  useEffect(() => {
    if (!editor) return;
    return createImageMenu(editor, {
      onShow: (r, i) => {
        setRect(r);
        setInfo(i);
        setWidth(String(Math.round(i.node.attrs["width"] as number)));
        setHeight(String(Math.round(i.node.attrs["height"] as number)));
        setWrappingMode(resolveWrappingMode(i.node.attrs));
      },
      onMove: (r, i) => {
        setRect(r);
        setInfo(i);
        setWrappingMode(resolveWrappingMode(i.node.attrs));
      },
      onHide: () => {
        setRect(null);
        setInfo(null);
      },
    });
  }, [editor]);

  const currentAlign =
    (info?.node.attrs["verticalAlign"] as ImageVerticalAlign | undefined) ??
    "baseline";

  function applyAttr(attrs: Record<string, unknown>) {
    if (!editor || !info) return;
    editor.setNodeAttrs(info.docPos, attrs);
  }

  function commitDimensions() {
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    if (w > 0 && h > 0) applyAttr({ width: w, height: h });
  }

  function setAlign(align: ImageVerticalAlign) {
    applyAttr({ verticalAlign: align });
  }

  function setWrapMode(mode: ImageWrappingMode) {
    setWrappingMode(mode);
    if (mode === "inline" && wrappingMode !== "inline") {
      if (info) editor?.convertImageToInlineAtVisualPosition(info.docPos);
      return;
    }
    applyAttr({ wrapMode: mode, wrappingMode: "inline" });
  }

  return {
    visible: !!rect && !!info,
    rect,
    info,
    position,
    rootRef: ref,
    width,
    height,
    setWidth,
    setHeight,
    wrappingMode,
    currentAlign,
    isFloat: wrappingMode !== "inline",
    alignOptions: ALIGN_OPTIONS,
    wrapOptions: WRAP_OPTIONS,
    commitDimensions,
    setAlign,
    setWrapMode,
  };
}

function resolveWrappingMode(attrs: Record<string, unknown>): ImageWrappingMode {
  const wrapMode = attrs["wrapMode"];
  if (
    wrapMode === "square" ||
    wrapMode === "top-bottom" ||
    wrapMode === "behind" ||
    wrapMode === "front"
  ) {
    return wrapMode;
  }

  const legacy = attrs["wrappingMode"];
  if (legacy === "square-left" || legacy === "square-right") return "square";
  if (
    legacy === "inline" ||
    legacy === "top-bottom" ||
    legacy === "behind" ||
    legacy === "front"
  ) {
    return legacy;
  }
  if (wrapMode === "inline") return "inline";
  return "inline";
}
