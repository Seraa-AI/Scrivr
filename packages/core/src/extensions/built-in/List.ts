import { wrapInList, splitListItem, liftListItem, sinkListItem } from "prosemirror-schema-list";
import type { PdfNodeHandler } from "../../exports/pdf";
import { chainCommands, liftEmptyBlock } from "prosemirror-commands";
import { splitBlockInheritAttrs } from "./Paragraph";
import { wrappingInputRule } from "prosemirror-inputrules";
import type { Node as PmNode, NodeType } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";
import {
  isListType,
  LIST_LEVEL_COUNT,
  LIST_MARKER_HANGING,
  listKind,
  listLevel,
  listStart,
  type ListKind,
} from "../../model/lists";
import type { SlashCommandContribution, ToolbarItemSpec } from "../types";
import { KeymapPriority } from "../types";
import {
  pxToTwips,
  xml,
  type DocxContext,
  type DocxNodeHandler,
  type DocxNumberingLevel,
  type XmlNode,
} from "../../exports/docx";
import type { SemanticNodeHandler } from "../../exports/semantic";
import type { DocxBlockTransform } from "../../exports/docx";

// ── DOCX export internals ───────────────────────────────────────────────────

interface ListItemDocxInfo {
  numId: number;
  ilvl: number;
}

const LIST_ITEMS_KEY = "docx:listItems";

/** The order the schema requires inside `w:pPr` (CT_PPrBase, then CT_PPr). */
const PPR_ORDER: readonly string[] = [
  "w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl",
  "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens",
  "w:kinsoku", "w:wordWrap", "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
  "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing",
  "w:mirrorIndents", "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment",
  "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
];

/** The order the schema requires inside `w:tblPr` (CT_TblPrBase, then CT_TblPr). */
const TBLPR_ORDER: readonly string[] = [
  "w:tblStyle", "w:tblpPr", "w:tblOverlap", "w:bidiVisual", "w:tblStyleRowBandSize",
  "w:tblStyleColBandSize", "w:tblW", "w:jc", "w:tblCellSpacing", "w:tblInd", "w:tblBorders",
  "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption", "w:tblDescription",
  "w:tblPrChange",
];

const childNamed = (node: XmlNode, name: string) =>
  (node.children ?? []).find((c): c is XmlNode => typeof c !== "string" && c.name === name);

/**
 * Adds `property` to the properties element `container` (`w:pPr`, `w:tblPr`)
 * of `element`, where `order` puts it: before the first property the schema
 * orders after it. The properties element is created as `element`'s first
 * child when it has none.
 */
function withProperty(element: XmlNode, container: string, property: XmlNode, order: readonly string[]): XmlNode {
  const rank = (name: string) => order.indexOf(name);
  const children = element.children ?? [];
  const at = children.findIndex((c) => typeof c !== "string" && c.name === container);
  const props = at >= 0 ? children[at] : undefined;
  if (props === undefined || typeof props === "string") {
    return xml(element.name, element.attributes, [xml(container, undefined, [property]), ...children]);
  }
  const existing = props.children ?? [];
  const before = existing.findIndex((c) => typeof c !== "string" && rank(c.name) > rank(property.name));
  const placed = before < 0
    ? [...existing, property]
    : [...existing.slice(0, before), property, ...existing.slice(before)];
  const next = [...children];
  next[at] = xml(container, props.attributes, placed);
  return xml(element.name, element.attributes, next);
}

const numPrOf = (numId: number, ilvl: number) =>
  xml("w:numPr", undefined, [
    xml("w:ilvl", { "w:val": String(ilvl) }),
    xml("w:numId", { "w:val": String(numId) }),
  ]);

/** Numbers an item's first paragraph. Anything else passes through. */
function numbered(p: XmlNode, numId: number, ilvl: number): XmlNode {
  return p.name === "w:p" ? withProperty(p, "w:pPr", numPrOf(numId, ilvl), PPR_ORDER) : p;
}

/**
 * An item's blocks after its first sit at the level's text indent: a
 * paragraph as Word's unnumbered continuation paragraph, a table indented by
 * `w:tblInd`. One that already has a number or an indent belongs to a deeper
 * item, whose handler placed it.
 */
function indentToItemText(block: XmlNode, ilvl: number): XmlNode {
  const left = String(pxToTwips(listLevel(ilvl).textIndent));
  if (block.name === "w:p") {
    const pPr = childNamed(block, "w:pPr");
    if (pPr && (childNamed(pPr, "w:numPr") || childNamed(pPr, "w:ind"))) return block;
    return withProperty(block, "w:pPr", xml("w:ind", { "w:left": left }), PPR_ORDER);
  }
  if (block.name === "w:tbl") {
    const tblPr = childNamed(block, "w:tblPr");
    if (tblPr && childNamed(tblPr, "w:tblInd")) return block;
    return withProperty(block, "w:tblPr", xml("w:tblInd", { "w:w": left, "w:type": "dxa" }), TBLPR_ORDER);
  }
  return block;
}

/** What a level's number looks like in Word, by list kind. */
const LEVEL_FORMATS: Record<ListKind, (ilvl: number) => Pick<DocxNumberingLevel, "format" | "text">> = {
  bullet: (ilvl) => ({ format: "bullet", text: listLevel(ilvl).bullet.glyph }),
  ordered: (ilvl) => ({ format: listLevel(ilvl).ordered.format, text: `%${ilvl + 1}.` }),
};

/** Word's levels as the editor draws them: nine, each with its format and indent. */
function docxLevels(kind: ListKind): DocxNumberingLevel[] {
  return Array.from({ length: LIST_LEVEL_COUNT }, (_, ilvl) => ({
    level: ilvl,
    ...LEVEL_FORMATS[kind](ilvl),
    left: pxToTwips(listLevel(ilvl).textIndent),
    hanging: pxToTwips(LIST_MARKER_HANGING),
  }));
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

      if (isListType(ancestor.type)) {
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

const listPdf: PdfNodeHandler = (block, ctx) => ctx.draw.lines(block, ctx);

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

  // Enter must reach `splitListItem` before Paragraph's `splitBlockInheritAttrs`
  // — which is also the last link in List's own Enter chain, so Paragraph
  // running first would always succeed and no list item would ever split.
  keymapPriority: KeymapPriority.list,

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
        toDOM: (node) => ["ol", { start: listStart(node) }, 0],
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

  addSlashCommands(): SlashCommandContribution[] {
    return [{
      items: [
        {
          id: "list.bullet",
          label: "Bullet list",
          description: "Unordered list",
          group: "lists",
          order: 10,
          command: "toggleBulletList",
        },
        {
          id: "list.ordered",
          label: "Ordered list",
          description: "Numbered list",
          group: "lists",
          order: 20,
          command: "toggleOrderedList",
        },
      ],
    }];
  },

  // The inverse of `addExports`' numbering: a `<w:numPr>` on a run of
  // paragraphs is a list, and turning that back into nested nodes is this
  // extension's business because it is this extension that declares them. The
  // walker reads each item's children through `ctx.walkBlocks`, so whatever
  // owns a paragraph or a table inside a list item still renders it.
  addImports() {
    const handler: DocxBlockTransform = (block, _content, ctx) => {
      if (block.type !== "list") return null;
      const listTypeName = block.listType === "bullet" ? "bulletList" : "orderedList";
      const listType = ctx.schema.nodes[listTypeName];
      const listItemType = ctx.schema.nodes["listItem"];
      if (!listType || !listItemType) {
        ctx.diagnostics.warn({
          code: "schema-missing-list",
          message: `Schema has no \`${listTypeName}\` / \`listItem\` — list dropped`,
        });
        return null;
      }

      const items: PmNode[] = [];
      for (const item of block.items) {
        const children = ctx.walkBlocks(item.content);
        if (children.length === 0) continue;
        items.push(listItemType.create(null, children));
      }
      return items.length === 0 ? null : listType.create(null, items);
    };

    return { docx: { blocks: { list: handler } } };
  },

  addExports() {
    // Lists need numbering.xml entries + per-paragraph <w:numPr>. The
    // walker visits children before the parent handler runs, so the
    // bulletList/orderedList type isn't visible when each listItem is
    // walked. Pre-compute the per-listItem (numId, ilvl) in
    // onBeforeExport by walking the doc with a list-type stack, then
    // the listItem handler reads from that map. The levels come from
    // listLevel, as layout's do, so Word shows what the editor shows.
    const onBeforeExport = (ctx: DocxContext) => {
      const itemMap = ctx.shared.getOrInit<Map<PmNode, ListItemDocxInfo>>(
        LIST_ITEMS_KEY,
        () => new Map(),
      );

      const numIds = new Map<ListKind, number>();
      const numIdFor = (kind: ListKind): number => {
        const known = numIds.get(kind);
        if (known !== undefined) return known;
        const { numId } = ctx.numbering.getOrCreate({ type: kind, levels: docxLevels(kind) });
        numIds.set(kind, numId);
        return numId;
      };

      const walk = (node: PmNode, stack: ListKind[]) => {
        const kind = listKind(node);
        const enclosing = stack[stack.length - 1];
        if (enclosing && node.type.name === "listItem") {
          itemMap.set(node, { numId: numIdFor(enclosing), ilvl: Math.min(stack.length - 1, LIST_LEVEL_COUNT - 1) });
        }
        node.forEach((child) => walk(child, kind ? [...stack, kind] : stack));
      };
      walk(ctx.editor.getState().doc, []);
    };

    // bulletList / orderedList don't emit their own element — Word lists are
    // a flat sequence of <w:p> elements that reference the same numId. The
    // wrapper handlers pass children through; listItem numbers its first
    // <w:p> and indents the rest as continuation paragraphs.
    const listPassthrough: DocxNodeHandler = (_node, children) => children;

    const listItemHandler: DocxNodeHandler = (node, children, ctx) => {
      const info = ctx.shared.get<Map<PmNode, ListItemDocxInfo>>(LIST_ITEMS_KEY)?.get(node);
      if (!info || children.length === 0) return children;
      return children.map((child, i) =>
        i === 0 ? numbered(child, info.numId, info.ilvl) : indentToItemText(child, info.ilvl),
      );
    };

    // A whole list is one semantic unit — the walker never descends into
    // listItems, so only the wrappers register. text/markdown come from the
    // shared serializer (correct `-`/`1.` markers).
    const listSemanticHandler: SemanticNodeHandler = () => ({ type: "list" });

    return {
      docx: {
        onBeforeExport,
        nodes: {
          bulletList: listPassthrough,
          orderedList: listPassthrough,
          listItem: listItemHandler,
        },
      },
      pdf: {
        nodes: {
          bulletList: listPdf,
          orderedList: listPdf,
          listItem: listPdf,
        },
      },
      semantic: {
        nodes: {
          bulletList: listSemanticHandler,
          orderedList: listSemanticHandler,
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
          const start = listStart(node);
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
