import { wrapInList, splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { chainCommands, liftEmptyBlock } from "prosemirror-commands";
import { splitBlockInheritAttrs } from "./Paragraph";
import { wrappingInputRule } from "prosemirror-inputrules";
import type { Node as PmNode, NodeType } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";
import { ListItemStrategy } from "../../layout/ListItemStrategy";
import type { ToolbarItemSpec } from "../types";
import {
  xml,
  type DocxContext,
  type DocxNodeHandler,
  type XmlNode,
} from "../../exports/docx";

// ── DOCX export internals ───────────────────────────────────────────────────

interface ListItemDocxInfo {
  numId: number;
  ilvl: number;
}

const LIST_ITEMS_KEY = "docx:listItems";

/**
 * Add `<w:numPr>` (with `w:ilvl` + `w:numId`) into the paragraph's pPr.
 * Returns the same XmlNode if it's not a `<w:p>` so non-paragraph children
 * (nested lists' own paragraphs etc.) pass through untouched.
 */
function addNumPrToParagraph(p: XmlNode, numId: number, ilvl: number): XmlNode {
  if (p.name !== "w:p") return p;
  const numPr = xml("w:numPr", undefined, [
    xml("w:ilvl", { "w:val": String(ilvl) }),
    xml("w:numId", { "w:val": String(numId) }),
  ]);
  const existingChildren = p.children ?? [];
  const pPrIdx = existingChildren.findIndex(
    (c) => typeof c !== "string" && c.name === "w:pPr",
  );
  const pPr = pPrIdx >= 0 ? existingChildren[pPrIdx] : undefined;
  if (pPr !== undefined && typeof pPr !== "string") {
    const newPPr = xml("w:pPr", pPr.attributes, [...(pPr.children ?? []), numPr]);
    const newChildren = [...existingChildren];
    newChildren[pPrIdx] = newPPr;
    return xml(p.name, p.attributes, newChildren);
  }
  return xml(p.name, p.attributes, [
    xml("w:pPr", undefined, [numPr]),
    ...existingChildren,
  ]);
}

/**
 * Toggle a list type — mirrors Google Docs behaviour:
 *  - Not in a list        → wrap in the given list type
 *  - Already in same type → lift all items back to paragraphs
 *  - In a different type  → convert to the given list type (setNodeMarkup)
 */
function makeToggleList(listType: NodeType, itemType: NodeType): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;

    for (let d = $from.depth; d > 0; d--) {
      const ancestor = $from.node(d);

      if (ancestor.type === listType) {
        // Same list type — toggle off
        return liftListItem(itemType)(state, dispatch);
      }

      if (ancestor.type.name === "bulletList" || ancestor.type.name === "orderedList") {
        // Different list type — convert
        if (dispatch) {
          dispatch(state.tr.setNodeMarkup($from.before(d), listType));
        }
        return true;
      }
    }

    // Not in any list — wrap
    return wrapInList(listType)(state, dispatch);
  };
}

/**
 * List — bullet and ordered list support.
 *
 * Nodes added:
 *   bulletList  — unordered list container
 *   orderedList — ordered list container (attrs: order)
 *   listItem    — single list item (content: paragraph block*)
 *
 * Keyboard behaviour (matches Google Docs / Word):
 *   Enter           → split list item (exit list when item is empty)
 *   Tab             → sink list item (indent deeper)
 *   Shift-Tab       → lift list item (dedent / exit list)
 *
 * Toolbar:
 *   • Bullet list
 *   1. Ordered list
 */
export const List = Extension.create({
  name: "list",

  addNodes() {
    return {
      bulletList: {
        group: "block",
        content: "listItem+",
        attrs: {
          nodeId:      { default: null },
          dataTracked: { default: [] },
        },
        parseDOM: [{ tag: "ul" }],
        toDOM: () => ["ul", 0],
      },
      orderedList: {
        group: "block",
        content: "listItem+",
        attrs: {
          order:       { default: 1 },
          nodeId:      { default: null },
          dataTracked: { default: [] },
        },
        parseDOM: [
          {
            tag: "ol",
            getAttrs: (dom) => ({
              order: (dom as HTMLOListElement).start ?? 1,
            }),
          },
        ],
        toDOM: (node) => ["ol", { start: node.attrs["order"] }, 0],
      },
      listItem: {
        content: "paragraph block*",
        defining: true,
        attrs: {
          nodeId:      { default: null },
          dataTracked: { default: [] },
        },
        parseDOM: [{
          tag: "li",
          getAttrs(dom) {
            return { nodeId: (dom as HTMLElement).getAttribute("data-node-id") ?? null };
          },
        }],
        toDOM: (node) => {
          const attrs: Record<string, string> = {};
          if (node.attrs.nodeId) attrs["data-node-id"] = node.attrs.nodeId as string;
          return ["li", attrs, 0];
        },
      },
    };
  },

  addKeymap() {
    const { bulletList, orderedList, listItem } = this.schema.nodes;
    return {
      // Chain: liftEmptyBlock exits a list when the item is empty;
      // splitListItem handles Enter inside a non-empty list item;
      // splitBlockKeepMarks is the fallback for Enter outside lists.
      Enter: chainCommands(liftEmptyBlock, splitListItem(listItem!), splitBlockInheritAttrs),
      Tab: sinkListItem(listItem!),
      "Shift-Tab": liftListItem(listItem!),
      // Mod-Shift-8: toggle bullet list (⌘⇧8 = • on most keyboards)
      "Mod-Shift-8": makeToggleList(bulletList!, listItem!),
      // Mod-Shift-9: toggle ordered list (⌘⇧9 = ( )
      "Mod-Shift-9": makeToggleList(orderedList!, listItem!),
    };
  },

  addCommands() {
    const { bulletList, orderedList, listItem } = this.schema.nodes;
    return {
      toggleBulletList: () => makeToggleList(bulletList!, listItem!),
      toggleOrderedList: () => makeToggleList(orderedList!, listItem!),
      liftListItem: () => liftListItem(listItem!),
      sinkListItem: () => sinkListItem(listItem!),
    };
  },

  addLayoutHandlers() {
    return { list_item: ListItemStrategy };
  },

  addBlockStyles() {
    return {
      list_item: {
        font: "14px",
        spaceBefore: 0,
        spaceAfter: 4,
        align: "left" as const,
      },
    };
  },

  addToolbarItems(): ToolbarItemSpec[] {
    return [
      {
        command: "toggleBulletList",
        label: "•",
        title: "Bullet list (⌘⇧8)",
        group: "list",
        isActive: (_marks, blockType) => blockType === "bulletList",
      },
      {
        command: "toggleOrderedList",
        label: "1.",
        title: "Ordered list (⌘⇧9)",
        group: "list",
        isActive: (_marks, blockType) => blockType === "orderedList",
      },
    ];
  },

  addExports() {
    // Lists need numbering.xml entries + per-paragraph <w:numPr>. The
    // walker visits children before the parent handler runs, so the
    // bulletList/orderedList type isn't visible when each listItem is
    // walked. Pre-compute the per-listItem (numId, ilvl) in
    // onBeforeExport by walking the doc with a list-type stack, then
    // the listItem handler reads from that map and patches its first
    // <w:p> child with <w:numPr>.
    const onBeforeExport = (ctx: DocxContext) => {
      const itemMap = ctx.shared.getOrInit<Map<PmNode, ListItemDocxInfo>>(
        LIST_ITEMS_KEY,
        () => new Map(),
      );

      let bulletNumId: number | null = null;
      let orderedNumId: number | null = null;
      const getBulletNumId = () => {
        if (bulletNumId === null) {
          bulletNumId = ctx.numbering.getOrCreate({
            type: "bullet",
            levels: [
              { level: 0, format: "bullet", text: "•" },
              { level: 1, format: "bullet", text: "◦" },
              { level: 2, format: "bullet", text: "▪" },
            ],
          }).numId;
        }
        return bulletNumId;
      };
      const getOrderedNumId = () => {
        if (orderedNumId === null) {
          orderedNumId = ctx.numbering.getOrCreate({
            type: "ordered",
            levels: [
              { level: 0, format: "decimal", text: "%1." },
              { level: 1, format: "decimal", text: "%2." },
              { level: 2, format: "decimal", text: "%3." },
            ],
          }).numId;
        }
        return orderedNumId;
      };

      const walk = (node: PmNode, stack: ("bullet" | "ordered")[]) => {
        let next = stack;
        const name = node.type.name;
        if (name === "bulletList") next = [...stack, "bullet"];
        else if (name === "orderedList") next = [...stack, "ordered"];
        else if (name === "listItem" && stack.length > 0) {
          const ilvl = Math.min(stack.length - 1, 2);
          const enclosing = stack[stack.length - 1]!;
          const numId = enclosing === "bullet" ? getBulletNumId() : getOrderedNumId();
          itemMap.set(node, { numId, ilvl });
        }
        node.forEach((child) => walk(child, next));
      };
      walk(ctx.editor.getState().doc, []);
    };

    // bulletList / orderedList don't emit their own element — Word lists are
    // a flat sequence of <w:p> elements that reference the same numId. The
    // wrapper handlers pass children through; listItem patches the first
    // child <w:p> with <w:numPr>.
    const listPassthrough: DocxNodeHandler = (_node, children) => children;

    const listItemHandler: DocxNodeHandler = (node, children, ctx) => {
      const info = ctx.shared.get<Map<PmNode, ListItemDocxInfo>>(LIST_ITEMS_KEY)?.get(node);
      if (!info || children.length === 0) return children;
      return children.map((child, i) =>
        i === 0 ? addNumPrToParagraph(child, info.numId, info.ilvl) : child,
      );
    };

    return {
      docx: {
        onBeforeExport,
        nodes: {
          bulletList: listPassthrough,
          orderedList: listPassthrough,
          listItem: listItemHandler,
        },
      },
    };
  },

  addInputRules() {
    const { bulletList, orderedList, listItem } = this.schema.nodes;
    const rules = [];
    if (bulletList && listItem) {
      // "- " or "* " at start of paragraph → bullet list
      rules.push(wrappingInputRule(/^\s*([-*])\s$/, bulletList));
    }
    if (orderedList && listItem) {
      // "1. " at start → ordered list (number is preserved as the start attr)
      rules.push(
        wrappingInputRule(
          /^(\d+)\.\s$/,
          orderedList,
          (match) => ({ order: +match[1]! }),
          (match, node) => node.childCount + (node.attrs["order"] as number) === +match[1]!,
        ),
      );
    }
    return rules;
  },

  addMarkdownParserTokens() {
    return {
      bullet_list: { block: "bulletList" },
      ordered_list: {
        block: "orderedList",
        getAttrs: (tok) => ({ order: +(tok.attrGet("start") ?? 1) }),
      },
      list_item: { block: "listItem" },
    };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        bulletList(state, node) {
          state.renderList(node, "  ", () => "- ");
        },
        orderedList(state, node) {
          const start = (node.attrs["order"] as number) || 1;
          const maxW = String(start + node.childCount - 1).length;
          const pad = " ".repeat(maxW + 2);
          state.renderList(node, pad, (i) => {
            const n = String(start + i);
            return " ".repeat(maxW - n.length) + n + ". ";
          });
        },
        listItem(state, node) {
          state.renderContent(node);
        },
      },
    };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    list: {
      /** Toggle a bullet list at the current block. */
      toggleBulletList: () => ReturnType;
      /** Toggle an ordered list at the current block. */
      toggleOrderedList: () => ReturnType;
      /** Lift a list item out of its list. */
      liftListItem: () => ReturnType;
      /** Sink a list item into a nested list. */
      sinkListItem: () => ReturnType;
    };
  }

  interface NodeAttributes {
    bullet_list: {
      /** Node ID assigned by UniqueId extension. */
      id?: string;
    };
    ordered_list: {
      /** Node ID assigned by UniqueId extension. */
      id?: string;
      /** Starting number for the ordered list. */
      order?: number;
    };
  }
}
