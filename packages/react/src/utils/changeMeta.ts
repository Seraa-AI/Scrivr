import { CHANGE_OPERATION } from "@scrivr/plugins";
import type { MarkChange, TrackedChange } from "@scrivr/plugins";

export interface ChangeMeta {
  icon: string;
  label: string;
}

const MARK_ICONS: Record<string, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
  strikethrough: "S",
  highlight: "H",
  color: "●",
  fontSize: "Aa",
  fontFamily: "Ff",
  link: "↗",
};

export const MARK_LABELS: Record<string, string> = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strikethrough: "Strikethrough",
  highlight: "Highlight",
  color: "Color",
  fontSize: "Font Size",
  fontFamily: "Font Family",
  link: "Link",
};

/** How a change is named to a reviewer. */
export function getChangeMeta(change: TrackedChange): ChangeMeta {
  const op = change.dataTracked.operation;

  if (change.type === "text-change") {
    if (op === CHANGE_OPERATION.insert)
      return {
        icon: "+",
        label: "Insertion",
      };
    return {
      icon: "−",
      label: "Deletion",
    };
  }

  if (change.type === "mark-change") {
    const mc = change as MarkChange;
    const name = mc.mark.type.name;
    const isRemoval = op === CHANGE_OPERATION.delete;
    return {
      icon: MARK_ICONS[name] ?? "M",
      label: `${MARK_LABELS[name] ?? name} ${isRemoval ? "removed" : "added"}`,
    };
  }

  if (change.type === "node-attr-change") {
    return {
      icon: "≡",
      label: "Style changed",
    };
  }

  if (change.type === "wrap-change") {
    return {
      icon: "⊞",
      label: "Structure",
    };
  }

  if (change.type === "node-change") {
    if (op === CHANGE_OPERATION.insert)
      return {
        icon: "□+",
        label: "Block added",
      };
    if (op === CHANGE_OPERATION.delete)
      return {
        icon: "□−",
        label: "Block removed",
      };
    return {
      icon: "□",
      label: "Block changed",
    };
  }

  if (change.type === "reference-change") {
    return {
      icon: "↗",
      label: "Reference",
    };
  }

  return {
    icon: "?",
    label: op ?? "Change",
  };
}
