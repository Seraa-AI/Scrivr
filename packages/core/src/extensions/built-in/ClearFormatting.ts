import type { Node } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Extension } from "../Extension";

/**
 * ClearFormatting — `Mod-\` clears all inline marks and block-level
 * formatting from the selection, matching Google Docs behaviour:
 *
 * With selection:
 *   - Removes all marks (bold, italic, color, font size, font family, link…)
 *   - Converts heading / code_block → paragraph
 *   - Resets align and fontFamily attrs to defaults
 *   - Flattens list items back to plain paragraphs
 *
 * With no selection (collapsed cursor):
 *   - Marks cleared on the current word only
 *   - Block attrs reset on the whole paragraph (Google Docs convention)
 */
function clearFormatting(): Command {
  return (state, dispatch) => {
    const { schema, selection } = state;
    const { from, to, empty } = selection;

    // Expand to current word for inline mark removal when cursor is collapsed.
    let markFrom = from;
    let markTo = to;
    if (empty) {
      const $pos = selection.$from;
      const text = $pos.parent.textContent;
      const offset = $pos.parentOffset;
      const before = text.slice(0, offset).match(/\S+$/)?.[0] ?? "";
      const after = text.slice(offset).match(/^\S+/)?.[0] ?? "";
      markFrom = $pos.start() + offset - before.length;
      markTo = $pos.start() + offset + after.length;
    }

    let tr = state.tr;

    // ── 1. Remove all marks ──────────────────────────────────────────────────
    for (const markType of Object.values(schema.marks)) {
      tr = tr.removeMark(markFrom, markTo, markType);
    }

    // ── 2. Reset block-level formatting ─────────────────────────────────────
    // Collect textblocks first to avoid mutating while iterating.
    const paragraph = schema.nodes["paragraph"];
    if (paragraph) {
      const blocks: Array<{ pos: number; node: Node }> = [];
      tr.doc.nodesBetween(from, to || from, (node, pos) => {
        if (node.isTextblock) blocks.push({ pos, node });
      });

      // Reverse so later positions are patched first — keeps earlier offsets valid.
      for (const { pos, node } of blocks.reverse()) {
        if (node.type !== paragraph) {
          // heading, code_block → plain paragraph
          tr = tr.setBlockType(pos, pos + node.nodeSize, paragraph, {});
        } else {
          // Reset alignment + fontFamily overrides
          tr = tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            align: undefined,
            fontFamily: null,
          });
        }
      }
    }

    // ── 3. Flatten lists back to plain paragraphs ────────────────────────────
    // Replace each bullet_list / ordered_list with the paragraph content
    // extracted from its list_item children. Process in reverse so earlier
    // positions stay valid as the document shrinks.
    const listTypes = new Set(
      (["bulletList", "orderedList"] as const)
        .map((n) => schema.nodes[n])
        .filter(Boolean),
    );

    if (listTypes.size > 0 && paragraph) {
      const listsInRange: Array<{ pos: number; node: Node }> = [];
      tr.doc.nodesBetween(from, to || from, (node, pos) => {
        if (listTypes.has(node.type)) {
          listsInRange.push({ pos, node });
          return false; // don't recurse into the list
        }
      });

      for (const { pos, node: listNode } of listsInRange.reverse()) {
        // Collect the paragraph content from each list_item, flattening one level.
        const content: Node[] = [];
        listNode.forEach((item) => {
          item.forEach((block) => {
            // Ensure the block is a plain paragraph (strip any residual attrs).
            const para = block.type === paragraph
              ? paragraph.create({ ...block.attrs, align: undefined, fontFamily: null }, block.content, block.marks)
              : paragraph.create({}, block.content, block.marks);
            content.push(para);
          });
        });

        if (content.length === 0) continue;
        tr = tr.replaceWith(pos, pos + listNode.nodeSize, Fragment.from(content));
      }
    }

    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  };
}

export const ClearFormatting = Extension.create({
  name: "clearFormatting",

  addKeymap() {
    return {
      "Mod-\\": clearFormatting(),
    };
  },

  addCommands() {
    return {
      clearFormatting: () => clearFormatting(),
    };
  },

  addToolbarItems() {
    return [
      {
        command: "clearFormatting",
        label: "✕",
        title: "Clear formatting (⌘\\)",
        group: "format",
        isActive: () => false,
      },
    ];
  },
});
