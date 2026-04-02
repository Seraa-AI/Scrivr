import { wrapInList, splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import { chainCommands, liftEmptyBlock } from "prosemirror-commands";
import { splitBlockInheritAttrs } from "./Paragraph";
import { wrappingInputRule } from "prosemirror-inputrules";
import type { NodeType } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";
import { ListItemStrategy } from "../../layout/ListItemStrategy";
import type { ToolbarItemSpec } from "../types";

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
        parseDOM: [{ tag: "ul" }],
        toDOM: () => ["ul", 0],
      },
      orderedList: {
        group: "block",
        content: "listItem+",
        attrs: { order: { default: 1 } },
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
