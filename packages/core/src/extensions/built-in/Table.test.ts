import { describe, it, expect } from "vitest";
import { Table } from "./Table";
import { DefaultContent } from "./DefaultContent";
import { Editor } from "../../Editor";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { ExtensionManager } from "../ExtensionManager";
import { createTestEditor } from "../../test-utils";
import { DOMParser as PMDOMParser } from "prosemirror-model";
import type { Node } from "prosemirror-model";
import type { LayoutBlock } from "../../layout/BlockLayout";

// Table ships behind an opt-in flag (see `chore/tables-default-off`); build a
// local context that enables it so the schema-integration assertions below
// see the table nodes.
const fullSchema = new ExtensionManager([StarterKit.configure({ table: true })]).schema;
const resolvedWithSchema = Table.resolve(fullSchema);

// ── addNodes ──────────────────────────────────────────────────────────────────

describe("Table — addNodes", () => {
  const resolved = Table.resolve();

  it("registers exactly four nodes: table, tableRow, tableCell, tableHeader", () => {
    expect(Object.keys(resolved.nodes).sort()).toEqual([
      "table",
      "tableCell",
      "tableHeader",
      "tableRow",
    ]);
  });

  it("table is in the block group", () => {
    expect(resolved.nodes["table"]!.group).toContain("block");
  });

  it("table content is tableRow+", () => {
    expect(resolved.nodes["table"]!.content).toBe("tableRow+");
  });

  it("table is isolating so cursor cannot escape into table internals via doc edits", () => {
    expect(resolved.nodes["table"]!.isolating).toBe(true);
  });

  it("table.attrs.layout defaults to 'fixed'", () => {
    const layoutAttr = resolved.nodes["table"]!.attrs?.["layout"];
    expect(layoutAttr?.default).toBe("fixed");
  });

  it("table.attrs.grid defaults to an empty number array (replaced on insert)", () => {
    const gridAttr = resolved.nodes["table"]!.attrs?.["grid"];
    expect(Array.isArray(gridAttr?.default)).toBe(true);
  });

  it("tableRow content allows tableCell or tableHeader children", () => {
    expect(resolved.nodes["tableRow"]!.content).toBe("(tableCell | tableHeader)+");
  });

  it("tableRow has repeatHeader and allowBreakAcrossPages attrs (Word-shaped)", () => {
    const attrs = resolved.nodes["tableRow"]!.attrs;
    expect(attrs?.["repeatHeader"]).toBeDefined();
    expect(attrs?.["allowBreakAcrossPages"]).toBeDefined();
    expect(attrs?.["repeatHeader"]?.default).toBe(false);
    expect(attrs?.["allowBreakAcrossPages"]?.default).toBe(false);
  });

  it("tableCell content is block+ (cells host any block content)", () => {
    expect(resolved.nodes["tableCell"]!.content).toBe("block+");
  });

  it("tableCell is isolating so Backspace at cell boundary cannot delete the cell", () => {
    expect(resolved.nodes["tableCell"]!.isolating).toBe(true);
  });

  it("tableHeader is isolating", () => {
    expect(resolved.nodes["tableHeader"]!.isolating).toBe(true);
  });

  it("tableCell carries Word-shaped attrs (gridSpan, vMerge, hAlign, vAlign)", () => {
    const attrs = resolved.nodes["tableCell"]!.attrs;
    expect(attrs?.["gridSpan"]?.default).toBe(1);
    expect(attrs?.["vMerge"]?.default).toBe("none");
    expect(attrs?.["hAlign"]?.default).toBeDefined();
    expect(attrs?.["vAlign"]?.default).toBeDefined();
  });

  it("tableCell parses from <td> tag", () => {
    const rule = resolved.nodes["tableCell"]!.parseDOM?.[0];
    expect((rule as { tag: string }).tag).toBe("td");
  });

  it("tableHeader parses from <th> tag", () => {
    const rule = resolved.nodes["tableHeader"]!.parseDOM?.[0];
    expect((rule as { tag: string }).tag).toBe("th");
  });
});

// ── addLayoutHandlers ─────────────────────────────────────────────────────────

describe("Table — addLayoutHandlers", () => {
  it("registers a layout handler keyed tableRow (rows are the rendered unit)", () => {
    expect(Table.resolve().layoutHandlers["tableRow"]).toBeDefined();
  });
});

// ── addCommands ───────────────────────────────────────────────────────────────

describe("Table — addCommands", () => {
  it("exposes insertTable command (requires schema)", () => {
    expect(resolvedWithSchema.commands["insertTable"]).toBeDefined();
  });

  it("exposes deleteTable command (requires schema)", () => {
    expect(resolvedWithSchema.commands["deleteTable"]).toBeDefined();
  });
});

// ── Schema integration ────────────────────────────────────────────────────────

describe("Table — schema integration (with StarterKit.configure({ table: true }))", () => {
  it("the opted-in starter-kit schema includes all four table nodes", () => {
    expect(fullSchema.nodes["table"]).toBeDefined();
    expect(fullSchema.nodes["tableRow"]).toBeDefined();
    expect(fullSchema.nodes["tableCell"]).toBeDefined();
    expect(fullSchema.nodes["tableHeader"]).toBeDefined();
  });

  it("a 2x2 table round-trips structurally through schema.nodeFromJSON", () => {
    const cell = (text: string): unknown => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const json = {
      type: "table",
      attrs: { layout: "fixed", grid: [100, 100] },
      content: [
        { type: "tableRow", content: [cell("a1"), cell("b1")] },
        { type: "tableRow", content: [cell("a2"), cell("b2")] },
      ],
    };
    const node = fullSchema.nodeFromJSON(json);
    expect(node.type.name).toBe("table");
    expect(node.attrs["layout"]).toBe("fixed");
    expect(node.attrs["grid"]).toEqual([100, 100]);
    expect(node.childCount).toBe(2);
    expect(node.firstChild?.type.name).toBe("tableRow");
    expect(node.firstChild?.childCount).toBe(2);
    // Spot-check the corner cell's text content survived the round trip.
    expect(node.lastChild?.lastChild?.textContent).toBe("b2");
  });
});

// ── End-to-end via Editor ─────────────────────────────────────────────────────

describe("Table — insertTable / deleteTable / undo-redo", () => {
  function makeEditor(): { editor: Editor; type: (s: string) => void; cleanup: () => void } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({ extensions: [StarterKit.configure({ table: true })] });
    editor.mount(container);
    const type = (s: string): void => {
      const ta = container.querySelector("textarea");
      if (!ta) return;
      ta.value = s;
      ta.dispatchEvent(new Event("input"));
    };
    return {
      editor,
      type,
      cleanup: () => {
        editor.destroy();
        container.remove();
      },
    };
  }

  function findTable(doc: Node): Node | null {
    let found: Node | null = null;
    doc.descendants((node) => {
      if (found) return false;
      if (node.type.name === "table") {
        found = node;
        return false;
      }
      return true;
    });
    return found;
  }

  it("insertTable({rows: 3, cols: 2}) places a 3x2 table at the cursor", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["insertTable"]?.({ rows: 3, cols: 2 });
    const table = findTable(editor.getState().doc);
    expect(table).not.toBeNull();
    expect(table!.childCount).toBe(3); // 3 rows
    expect(table!.firstChild!.childCount).toBe(2); // 2 cols
    cleanup();
  });

  it("insertTable initialises grid with `cols` numeric column widths", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["insertTable"]?.({ rows: 2, cols: 3 });
    const table = findTable(editor.getState().doc);
    expect(table).not.toBeNull();
    const grid = table!.attrs["grid"];
    expect(Array.isArray(grid)).toBe(true);
    expect((grid as number[]).length).toBe(3);
    expect((grid as number[]).every((w) => w > 0)).toBe(true);
    cleanup();
  });

  it("each cell of a fresh table contains an empty paragraph (cursor target)", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["insertTable"]?.({ rows: 1, cols: 1 });
    const table = findTable(editor.getState().doc);
    const cell = table!.firstChild!.firstChild!;
    expect(cell.type.name).toBe("tableCell");
    expect(cell.firstChild?.type.name).toBe("paragraph");
    expect(cell.firstChild?.textContent).toBe("");
    cleanup();
  });

  it("deleteTable() removes a surrounding table when the selection is inside it", () => {
    const { editor, cleanup } = makeEditor();
    editor.commands["insertTable"]?.({ rows: 2, cols: 2 });
    // Move cursor inside the first cell.
    const tablePos = (() => {
      let p = -1;
      editor.getState().doc.descendants((node, pos) => {
        if (p >= 0) return false;
        if (node.type.name === "table") { p = pos; return false; }
        return true;
      });
      return p;
    })();
    expect(tablePos).toBeGreaterThanOrEqual(0);
    // Place cursor inside the first paragraph of the first cell.
    editor.selection.moveCursorTo(tablePos + 4);
    editor.commands["deleteTable"]?.();
    expect(findTable(editor.getState().doc)).toBeNull();
    cleanup();
  });

  it("undo restores the doc after insertTable; redo re-inserts it", () => {
    const { editor, cleanup } = makeEditor();
    const before = editor.getState().doc.toJSON();
    editor.commands["insertTable"]?.({ rows: 2, cols: 2 });
    expect(findTable(editor.getState().doc)).not.toBeNull();
    editor.commands["undo"]?.();
    expect(editor.getState().doc.toJSON()).toEqual(before);
    expect(findTable(editor.getState().doc)).toBeNull();
    editor.commands["redo"]?.();
    expect(findTable(editor.getState().doc)).not.toBeNull();
    cleanup();
  });
});

// ── Markdown export ───────────────────────────────────────────────────────────
// Whenever Table is opted in (StarterKit.configure({ table: true })),
// getMarkdown() must not throw on docs containing a table. Phase 1 emits a
// GFM pipe table (cells flattened to text).

describe("Table — markdown export", () => {
  // Uses ServerEditor (no DOM, accepts `content` directly) to exercise the
  // same markdown serializer path as the browser Editor's getMarkdown().

  it("getMarkdown() does not throw on a doc containing an inserted table", () => {
    // Path 1: insertTable via the browser Editor (matches the reviewer's
    // exact scenario when Table is opted in).
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({ extensions: [StarterKit.configure({ table: true })] });
    editor.mount(container);
    editor.commands["insertTable"]?.({ rows: 2, cols: 2 });
    expect(() => editor.getMarkdown()).not.toThrow();
    editor.destroy();
    container.remove();
  });

  it("emits a GFM-style pipe table with a header separator row", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [100, 100] },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Role" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Ada" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Eng" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content });
    const md = editor.getMarkdown();
    expect(md).toContain("| Name | Role |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Ada | Eng |");
  });

  it("escapes pipe characters and collapses newlines inside cell text", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [100] },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "a|b" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })], content });
    const md = editor.getMarkdown();
    expect(md).toContain("a\\|b");
  });
});

// ── Browser Editor: content option round-trips a table ────────────────────────
// Locks in the contract that `new Editor({ content })` lands the JSON in the
// doc with the proper table structure — not silently dropped.

describe("Table — browser Editor parses initial content with a table", () => {
  it("hydrates a 2x2 table from the constructor's content option", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [120, 80] },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H1" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H2" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "v1" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "v2" }] }] },
              ],
            },
          ],
        },
      ],
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({ extensions: [StarterKit.configure({ table: true })], content });
    editor.mount(container);

    const doc = editor.getState().doc;
    let table: Node | null = null;
    doc.descendants((node) => {
      if (table) return false;
      if (node.type.name === "table") { table = node; return false; }
      return true;
    });

    expect(table).not.toBeNull();
    expect(table!.attrs["layout"]).toBe("fixed");
    expect(table!.attrs["grid"]).toEqual([120, 80]);
    expect(table!.childCount).toBe(2);

    // First row uses tableHeader cells; second uses tableCell.
    const firstRow = table!.firstChild!;
    expect(firstRow.firstChild?.type.name).toBe("tableHeader");
    expect(firstRow.firstChild?.textContent).toBe("H1");
    expect(firstRow.lastChild?.textContent).toBe("H2");

    const secondRow = table!.lastChild!;
    expect(secondRow.firstChild?.type.name).toBe("tableCell");
    expect(secondRow.firstChild?.textContent).toBe("v1");
    expect(secondRow.lastChild?.textContent).toBe("v2");

    editor.destroy();
    container.remove();
  });
});

// ── DefaultContent + Table: integration ───────────────────────────────────────
// Verifies that a JSON document containing a table, seeded via the
// DefaultContent extension, renders properly in the browser Editor:
//   - the doc contains the parsed table structure,
//   - mounting + layout doesn't crash on tableRow blocks,
//   - the layout pipeline emits one `kind: "tableRow"` LayoutBlock per row.

describe("Table — DefaultContent + browser Editor integration", () => {
  function tableJsonDoc(rows: number, cols: number): Record<string, unknown> {
    const buildCell = (r: number, c: number): unknown => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text: `r${r}c${c}` }] }],
    });
    const buildRow = (r: number): unknown => ({
      type: "tableRow",
      content: Array.from({ length: cols }, (_, c) => buildCell(r, c)),
    });
    return {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: Array.from({ length: cols }, () => 100) },
          content: Array.from({ length: rows }, (_, r) => buildRow(r)),
        },
      ],
    };
  }

  function findRowBlocks(editor: Editor): LayoutBlock[] {
    const rows: LayoutBlock[] = [];
    for (const page of editor.layout.pages) {
      for (const block of page.blocks) {
        if (block.kind === "tableRow") rows.push(block);
      }
    }
    return rows;
  }

  it("seeds a table via DefaultContent.configure({ json }) and lands it in the doc", () => {
    const json = tableJsonDoc(2, 3);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({
      extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json })],
    });
    editor.mount(container);

    let table: Node | null = null;
    editor.getState().doc.descendants((node) => {
      if (table) return false;
      if (node.type.name === "table") { table = node; return false; }
      return true;
    });

    expect(table).not.toBeNull();
    expect(table!.attrs["grid"]).toEqual([100, 100, 100]);
    expect(table!.childCount).toBe(2);
    expect(table!.firstChild!.childCount).toBe(3);
    expect(table!.firstChild!.firstChild!.textContent).toBe("r0c0");

    editor.destroy();
    container.remove();
  });

  it("renders the seeded table — layout pipeline emits one kind:\"tableRow\" block per row", () => {
    const json = tableJsonDoc(3, 2);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({
      extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json })],
    });
    // Mount + force layout. Errors during paint surface as exceptions here.
    editor.mount(container);
    expect(() => editor.layout).not.toThrow();

    const rowBlocks = findRowBlocks(editor);
    expect(rowBlocks.length).toBe(3);
    for (const block of rowBlocks) {
      expect(block.kind).toBe("tableRow");
      expect(block.lines).toEqual([]);
      // Phase 4: each row carries one cell sub-block per column, each with its
      // laid-out child blocks.
      expect(block.cells).toHaveLength(2);
      expect(block.cells!.every((c) => c.blocks.length > 0)).toBe(true);
      expect(block.height).toBeGreaterThan(0);
      expect(block.availableWidth).toBeGreaterThan(0);
    }

    editor.destroy();
    container.remove();
  });

  it("cell text is hit-testable — cursor coords land in the correct cell (Phase 4 render)", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [120, 120] },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "LEFT" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "RIGHT" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({
      extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json })],
    });
    editor.mount(container);
    editor.ensurePagePopulated(1);

    const posOf = (text: string): number => {
      let p = -1;
      editor.getState().doc.descendants((n, pos) => {
        if (n.isText && n.text === text) {
          p = pos;
          return false;
        }
        return true;
      });
      if (p < 0) throw new Error(`no text node "${text}"`);
      return p;
    };

    const left = editor.charMap.coordsAtPos(posOf("LEFT"));
    const right = editor.charMap.coordsAtPos(posOf("RIGHT"));
    // Both cells registered glyphs → the cursor can be placed inside a cell.
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    // The RIGHT cell sits to the right of the LEFT cell on the same row.
    expect(right!.x).toBeGreaterThan(left!.x);
    expect(Math.abs(right!.y - left!.y)).toBeLessThan(5);

    // Clicking in the RIGHT cell resolves to a position inside it.
    const hit = editor.charMap.posAtCoords(right!.x, right!.y + right!.height / 2, right!.page);
    expect(hit).toBeGreaterThanOrEqual(posOf("RIGHT"));

    editor.destroy();
    container.remove();
  });

  it("rejects misconfiguration when DefaultContent receives both markdown and json", () => {
    expect(() => {
      const editor = createTestEditor({
        extensions: [
          StarterKit.configure({ table: true }),
          DefaultContent.configure({ markdown: "# x", json: tableJsonDoc(1, 1) }),
        ],
      });
      // Some setups may defer extension resolution until first access.
      void editor.getState().doc;
    }).toThrow(/exactly one of/i);
  });

  it("EditorOptions.content overrides DefaultContent's json (per-instance precedence)", () => {
    const seeded = tableJsonDoc(2, 2);
    const override = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "override" }] }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createTestEditor({
      extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json: seeded })],
      content: override,
    });
    editor.mount(container);

    let foundTable = false;
    editor.getState().doc.descendants((node) => {
      if (node.type.name === "table") foundTable = true;
      return !foundTable;
    });
    expect(foundTable).toBe(false);
    expect(editor.getState().doc.textContent).toBe("override");

    editor.destroy();
    container.remove();
  });
});

// ── Feature flag: default StarterKit does NOT register Table ──────────────────
// Locks in the contract that Phase 1 ships behind an opt-in flag while the
// layout/render pipeline is filled in (Phases 2–4 of docs/tables.md).

describe("Table — StarterKit default-off feature flag", () => {
  it("default StarterKit does not include the table node in the schema", () => {
    const { schema } = (() => {
      const editor = new ServerEditor({ extensions: [StarterKit] });
      return { schema: editor.schema };
    })();
    expect(schema.nodes["table"]).toBeUndefined();
    expect(schema.nodes["tableRow"]).toBeUndefined();
    expect(schema.nodes["tableCell"]).toBeUndefined();
    expect(schema.nodes["tableHeader"]).toBeUndefined();
  });

  it("default StarterKit does not expose insertTable / deleteTable commands", () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    expect(editor.commands["insertTable"]).toBeUndefined();
    expect(editor.commands["deleteTable"]).toBeUndefined();
  });

  it("StarterKit.configure({ table: true }) registers the table schema", () => {
    const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })] });
    expect(editor.schema.nodes["table"]).toBeDefined();
    expect(editor.schema.nodes["tableRow"]).toBeDefined();
    expect(editor.schema.nodes["tableCell"]).toBeDefined();
    expect(editor.schema.nodes["tableHeader"]).toBeDefined();
  });
});

// ── HTML parse: schema parseDOM ───────────────────────────────────────────────
// Phase 2 scope per docs/tables.md: basic schema mapping from <table>/<tr>/
// <td>/<th>. Full paste cleanup (colspan→gridSpan, rowspan→vMerge,
// Word/GDocs noise stripping) lands in Phase 7.

describe("Table — HTML parse via schema parseDOM", () => {
  function parseHtml(html: string): Node {
    const div = document.createElement("div");
    div.innerHTML = html;
    return PMDOMParser.fromSchema(fullSchema).parse(div);
  }

  function findFirst(doc: Node, typeName: string): Node | null {
    let found: Node | null = null;
    doc.descendants((node) => {
      if (found) return false;
      if (node.type.name === typeName) { found = node; return false; }
      return true;
    });
    return found;
  }

  it("parses <table><tr><td>x</td></tr></table> into the table node tree", () => {
    const doc = parseHtml("<table><tr><td>cell text</td></tr></table>");
    const table = findFirst(doc, "table");
    expect(table).not.toBeNull();
    expect(table!.firstChild?.type.name).toBe("tableRow");
    expect(table!.firstChild!.firstChild!.type.name).toBe("tableCell");
    expect(table!.firstChild!.firstChild!.textContent).toBe("cell text");
  });

  it("parses <th> into a tableHeader node", () => {
    const doc = parseHtml("<table><tr><th>Header</th></tr></table>");
    const th = findFirst(doc, "tableHeader");
    expect(th).not.toBeNull();
    expect(th!.textContent).toBe("Header");
  });

  it("parses a 2x2 mixed header + data table", () => {
    const html = `
      <table>
        <tr><th>Name</th><th>Role</th></tr>
        <tr><td>Ada</td><td>Eng</td></tr>
      </table>
    `;
    const doc = parseHtml(html);
    const table = findFirst(doc, "table")!;
    expect(table.childCount).toBe(2);
    // Header row
    expect(table.firstChild!.firstChild!.type.name).toBe("tableHeader");
    expect(table.firstChild!.firstChild!.textContent).toBe("Name");
    expect(table.firstChild!.lastChild!.textContent).toBe("Role");
    // Data row
    expect(table.lastChild!.firstChild!.type.name).toBe("tableCell");
    expect(table.lastChild!.firstChild!.textContent).toBe("Ada");
    expect(table.lastChild!.lastChild!.textContent).toBe("Eng");
  });

  it("parses cell content as block+ — paragraphs are produced for cell text", () => {
    const doc = parseHtml("<table><tr><td>plain</td></tr></table>");
    const cell = findFirst(doc, "tableCell")!;
    expect(cell.firstChild?.type.name).toBe("paragraph");
    expect(cell.firstChild?.textContent).toBe("plain");
  });

  it("parses a <tbody> wrapper transparently (HTML-default insertion)", () => {
    const doc = parseHtml("<table><tbody><tr><td>x</td></tr></tbody></table>");
    const table = findFirst(doc, "table");
    expect(table).not.toBeNull();
    expect(table!.firstChild?.type.name).toBe("tableRow");
    expect(table!.firstChild!.firstChild!.textContent).toBe("x");
  });
});
