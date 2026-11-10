import { IMAGE_PLACEMENT_ATTRS } from "@scrivr/core";
import { CHANGE_OPERATION, changedAttrKeys } from "@scrivr/plugins";
import type { NodeAttrChange, TrackedChange } from "@scrivr/plugins";

export interface ChangeMeta {
  icon: string;
  label: string;
  /** What one decision on this change takes or keeps whole, such as a "row". */
  unit?: string;
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

const MOVED: ChangeMeta = { icon: "⇄", label: "Moved" };

/** Names by operation, with one for any operation not listed. */
type NamesByOperation = Partial<Record<CHANGE_OPERATION, ChangeMeta>> & { otherwise: ChangeMeta };

/** Kinds of change named from the table; formatting is named by its mark instead. */
export type NamedChangeType = Exclude<TrackedChange["type"], "mark-change">;

/** How each kind of change is named. */
const NAMES: Record<NamedChangeType, NamesByOperation> = {
  "text-change": {
    [CHANGE_OPERATION.insert]: { icon: "+", label: "Insertion" },
    otherwise: { icon: "−", label: "Deletion" },
  },
  "node-change": {
    [CHANGE_OPERATION.insert]: { icon: "□+", label: "Block added" },
    [CHANGE_OPERATION.delete]: { icon: "□−", label: "Block removed" },
    [CHANGE_OPERATION.node_split]: { icon: "¶+", label: "Paragraph break added" },
    [CHANGE_OPERATION.node_join]: { icon: "¶−", label: "Paragraph break removed" },
    [CHANGE_OPERATION.list_change]: { icon: "≔", label: "List changed" },
    [CHANGE_OPERATION.move]: MOVED,
    otherwise: { icon: "□", label: "Block changed" },
  },
  "node-attr-change": { otherwise: { icon: "≡", label: "Style changed" } },
  "wrap-change": { otherwise: { icon: "⊞", label: "Structure" } },
  "reference-change": { otherwise: { icon: "↗", label: "Reference" } },
};


/** Blocks named by what they are when added or removed, rather than as "a block". */
const NODE_NAMES: Partial<Record<string, Partial<Record<CHANGE_OPERATION, ChangeMeta>>>> = {
  tableRow: {
    [CHANGE_OPERATION.insert]: { icon: "▤+", label: "Row added", unit: "row" },
    [CHANGE_OPERATION.delete]: { icon: "▤−", label: "Row removed", unit: "row" },
  },
};

/** What a reviewer calls each kind of block. */
const BLOCK_NAMES: Record<string, string> = {
  paragraph: "Paragraph",
  heading: "Heading",
  listItem: "List item",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  table: "Table",
  image: "Image",
  codeBlock: "Code block",
  blockquote: "Quote",
  horizontalRule: "Horizontal line",
  pageBreak: "Page break",
};

/** A block added or removed, named by what it is: "List item added", or by its type when it has no name here. */
function blockName(nodeType: string, operation: CHANGE_OPERATION, generic: ChangeMeta): ChangeMeta | undefined {
  const name = BLOCK_NAMES[nodeType] ?? nodeType;
  if (operation === CHANGE_OPERATION.insert) return { icon: generic.icon, label: `${name} added` };
  if (operation === CHANGE_OPERATION.delete) return { icon: generic.icon, label: `${name} removed` };
  return undefined;
}

/** Only where the node sits changed, not what it is. */
const onlyPlaced = ({ oldAttrs, newAttrs }: NodeAttrChange) => {
  const changed = changedAttrKeys(oldAttrs, newAttrs);
  return changed.length > 0 && changed.every(key => IMAGE_PLACEMENT_ATTRS.includes(key));
};

/** A change's name from its kind and operation. Either half of a move is named as the move. */
export function changeName(type: NamedChangeType, operation: CHANGE_OPERATION | undefined, moved: boolean): ChangeMeta {
  if (moved) return MOVED;
  const names = NAMES[type];
  return (operation && names[operation]) || names.otherwise;
}

/** How a change is named to a reviewer. */
export function getChangeMeta(change: TrackedChange): ChangeMeta {
  const op = change.dataTracked.operation;
  if (change.type === "mark-change") {
    const name = change.mark.type.name;
    return {
      icon: MARK_ICONS[name] ?? "M",
      label: `${MARK_LABELS[name] ?? name} ${op === CHANGE_OPERATION.delete ? "removed" : "added"}`,
    };
  }
  const named = change.type === "node-change" && !change.dataTracked.moveNodeId
    ? NODE_NAMES[change.node.type.name]?.[op] ?? blockName(change.node.type.name, op, changeName(change.type, op, false))
    : undefined;
  if (named) return named;
  if (change.type === "node-attr-change" && onlyPlaced(change)) {
    const name = change.node.type.name;
    return { icon: "⇄", label: `${name.charAt(0).toUpperCase()}${name.slice(1)} moved` };
  }
  return changeName(change.type, op, !!change.dataTracked.moveId);
}

type PreviewVerb = "Adding" | "Removing" | "Moving";

/** "Accept", "Adding" or, for a change decided whole, "Accept row", "Adding row". */
export const decisionLabel = (verb: "Accept" | "Reject" | PreviewVerb, meta: ChangeMeta) =>
  meta.unit ? `${verb} ${meta.unit}` : verb;

// A text move's halves are an insertion and a deletion, so `moved` names them;
// a block move is its own operation.
const PREVIEW_VERB: Partial<Record<CHANGE_OPERATION, PreviewVerb>> = {
  [CHANGE_OPERATION.insert]: "Adding",
  [CHANGE_OPERATION.delete]: "Removing",
  [CHANGE_OPERATION.move]: "Moving",
};

/** What a change does to the words it previews; a split, a list change and the like show them as they are. */
export const previewVerb = (operation: CHANGE_OPERATION, moved: boolean): PreviewVerb | undefined =>
  moved ? "Moving" : PREVIEW_VERB[operation];
