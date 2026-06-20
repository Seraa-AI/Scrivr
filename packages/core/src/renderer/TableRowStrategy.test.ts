import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import type { LayoutBlock } from "../layout/BlockLayout";
import type { LayoutLine } from "../layout/LineBreaker";
import { BlockRegistry, InlineRegistry } from "../layout/BlockRegistry";
import { TextBlockStrategy } from "../layout/TextBlockStrategy";
import { CharacterMap } from "../layout/CharacterMap";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer } from "../test-utils";
import { defaultEditorTheme } from "../model/theme";
import { TableRowStrategy } from "./TableRowStrategy";

function rowNode(): { row: Node; image: Node } {
  const editor = new ServerEditor({
    extensions: [StarterKit.configure({ table: true })],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [120] },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph" }],
                },
              ],
            },
          ],
        },
      ],
    },
  });
  const table = editor.getState().doc.firstChild;
  const row = table?.firstChild;
  const image = editor.schema.nodes["image"]!.create({ src: "image.png", width: 24, height: 18 });
  if (!row) throw new Error("no row");
  return { row, image };
}

function objectLine(image: Node): LayoutLine {
  return {
    spans: [
      {
        kind: "object",
        node: image,
        x: 0,
        width: 24,
        height: 18,
        docPos: 6,
        verticalAlign: "baseline",
      },
    ],
    width: 24,
    lineHeight: 22,
    ascent: 18,
    descent: 4,
    cursorHeight: 18,
    textAscent: 14,
    xHeight: 7,
  };
}

function childBlock(line: LayoutLine, paragraph: Node): LayoutBlock {
  return {
    kind: "text",
    node: paragraph,
    nodePos: 4,
    x: 16,
    y: 4,
    width: 108,
    height: 22,
    lines: [line],
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: "paragraph",
    align: "left",
    availableWidth: 108,
  };
}

describe("TableRowStrategy", () => {
  it("dispatches inline object rendering for child blocks inside cells", () => {
    const { row, image } = rowNode();
    const line = objectLine(image);
    const paragraph = image.type.schema.nodes["paragraph"]!.create();
    const child = childBlock(line, paragraph);
    const block: LayoutBlock = {
      kind: "tableRow",
      node: row,
      nodePos: 1,
      x: 10,
      y: 20,
      width: 120,
      height: 40,
      lines: [],
      cells: [{ cellPos: 2, x: 10, y: 0, width: 120, height: 40, blocks: [child] }],
      spaceBefore: 0,
      spaceAfter: 0,
      blockType: "tableRow",
      align: "left",
      availableWidth: 120,
    };

    const blockRegistry = new BlockRegistry().register("paragraph", TextBlockStrategy);
    let rendered = 0;
    const inlineRegistry = new InlineRegistry().register("image", {
      render() {
        rendered++;
      },
    });
    const map = new CharacterMap();

    TableRowStrategy.render(
      block,
      {
        ctx: document.createElement("canvas").getContext("2d")!,
        pageNumber: 1,
        lineIndexOffset: 0,
        dpr: 1,
        measurer: createMeasurer(),
        theme: defaultEditorTheme,
        blockRegistry,
        inlineRegistry,
      },
      map,
    );

    expect(rendered).toBe(1);
    expect(map.getObjectRect(6)).toMatchObject({ x: 16, y: 24, width: 24, height: 18, page: 1 });
  });
});
