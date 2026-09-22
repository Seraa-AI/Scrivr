import { describe, expect, it, vi } from "vitest";
import { Extension, ServerEditor, StarterKit, type PdfMarkHandler } from "@scrivr/core";
import { buildPdf } from "../index";
import { block, onePage, schema, textLine } from "./fixtures";
import { recordDrawOps } from "./opLog";

const marked = (names: string[]) => onePage([
  block("paragraph", [textLine("visible", {
    marks: names.map(name => ({ name, attrs: {} })),
  })]),
]);

describe("PDF contribution registry boundary", () => {
  it.each(["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"])(
    "ignores an unregistered mark named %s", async name => {
      const editor = new ServerEditor({ extensions: [StarterKit] });
      await expect(buildPdf(marked([name]), editor)).resolves.toBeInstanceOf(Uint8Array);
    },
  );

  it("collects own entries only and lets later extensions override every lane", async () => {
    const inherited = vi.fn(() => ({ color: "red" }));
    const firstMark = vi.fn(() => ({ color: "red" }));
    const lastMark = vi.fn<PdfMarkHandler>(() => ({ color: "blue" }));
    const firstNode = vi.fn();
    const lastNode = vi.fn();
    const firstChrome = vi.fn();
    const lastChrome = vi.fn();
    const marks: Record<string, PdfMarkHandler> = Object.assign(
      Object.create({ inherited }), { ["__proto__"]: firstMark },
    );
    const First = Extension.create({
      name: "first",
      addExports: () => ({ pdf: {
        marks,
        nodes: { ["__proto__"]: firstNode },
        chrome: { ["__proto__"]: firstChrome },
      } }),
    });
    const Last = Extension.create({
      name: "last",
      addExports: () => ({ pdf: {
        marks: { ["__proto__"]: lastMark },
        nodes: { ["__proto__"]: lastNode },
        chrome: { ["__proto__"]: lastChrome },
      } }),
    });
    const editor = new ServerEditor({ extensions: [StarterKit, First, Last] });
    const layout = marked(["inherited", "__proto__"]);
    const customBlock = block("paragraph", []);
    // buildPdf accepts layout directly, including externally provided node names.
    customBlock.node = { type: { name: "__proto__" } } as typeof customBlock.node;
    layout.pages[0]!.blocks.push(customBlock);
    layout.chromePayloads = {};
    await buildPdf(layout, editor);
    expect(inherited).not.toHaveBeenCalled();
    expect(firstMark).not.toHaveBeenCalled();
    expect(firstNode).not.toHaveBeenCalled();
    expect(firstChrome).not.toHaveBeenCalled();
    expect(lastMark).toHaveBeenCalledTimes(1);
    expect(Object.keys(lastMark.mock.calls[0]![1])).toEqual(["theme"]);
    expect(lastNode).toHaveBeenCalledTimes(1);
    expect(lastChrome).toHaveBeenCalledTimes(1);
    expect(lastChrome.mock.calls[0]![1]).toBeUndefined();
  });
});

describe("PDF nested block dispatch", () => {
  it.each([false, true])("restores the parent's box after child dispatch (throws: %s)", async throws => {
    const parent = block("paragraph", [], { y: 100 });
    const child = { ...block("heading", [], { y: 120 }), x: 90, width: 100 };
    const failure = new Error("child rendering failed");
    const boxes: number[][] = [];
    let caught: unknown;
    const Custom = Extension.create({
      name: "nestedDispatch",
      addExports: () => ({ pdf: { nodes: {
        paragraph: (_block, ctx) => {
          boxes.push([ctx.x, ctx.y, ctx.width]);
          try {
            ctx.blocks([child]);
          } catch (error) {
            caught = error;
          }
          boxes.push([ctx.x, ctx.y, ctx.width]);
        },
        heading: (_block, ctx) => {
          boxes.push([ctx.x, ctx.y, ctx.width]);
          if (throws) throw failure;
        },
      } } }),
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Custom] });
    await buildPdf(onePage([parent]), editor);
    expect(boxes).toEqual([
      [parent.x, parent.y, parent.width],
      [child.x, child.y, child.width],
      [parent.x, parent.y, parent.width],
    ]);
    expect(caught).toBe(throws ? failure : undefined);
  });

  it("warns rather than crashing when a pre-export hook dispatches an unhandled block", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Custom = Extension.create({
      name: "beforeExportDispatch",
      addExports: () => ({ pdf: {
        onBeforeExport: ctx => { ctx.blocks([block("pageBreak", [])]); },
      } }),
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Custom] });
    const layout = onePage([block("paragraph", [textLine("visible")])]);
    await expect(buildPdf(layout, editor)).resolves.toBeInstanceOf(Uint8Array);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pageBreak"));
    warn.mockRestore();
  });
});

describe("PDF mark style boundary", () => {
  it.each(["var(--highlight)", "not-a-color", "color(display-p3 1 0 0)"])(
    "skips unsupported highlight %s without hiding text", async color => {
      const editor = new ServerEditor({ extensions: [StarterKit] });
      const layout = onePage([block("paragraph", [textLine("visible", {
        marks: [{ name: "highlight", attrs: { color } }],
      })])]);
      const ops = await recordDrawOps(() => buildPdf(layout, editor));
      expect(ops.filter(op => op.op === "rect")).toHaveLength(1); // page background only
      expect(ops.find(op => op.op === "text")?.["value"]).toBe("visible");
    },
  );

  it.each([NaN, Infinity, -0.1, 1.1])("ignores invalid opacity %s but keeps valid styling", async opacity => {
    const Custom = Extension.create({
      name: "custom",
      addExports: () => ({ pdf: { marks: {
        custom: () => ({
          color: "red", underline: true,
          backgroundColor: { color: "yellow", opacity },
        }),
      } } }),
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Custom] });
    const ops = await recordDrawOps(() => buildPdf(marked(["custom"]), editor));
    expect(ops.filter(op => op.op === "rect")).toHaveLength(1);
    expect(ops.find(op => op.op === "text")?.["color"]).toBe("rgb(1, 0, 0)");
    expect(ops.find(op => op.op === "line")?.["color"]).toBe("rgb(1, 0, 0)");
  });

  it.each([
    [["link", "invalid"], "rgb(0, 0.4, 0.8)"],
    [["invalid"], "rgb(0, 0, 0)"],
    [["authored", "invalid", "link"], "rgb(1, 0, 0)"],
  ] as const)("invalid declarations preserve the cascade for %s", async (names, expected) => {
    const Custom = Extension.create({
      name: "custom",
      addExports: () => ({ pdf: { marks: {
        authored: () => ({ color: "red" }),
        invalid: () => ({ color: "invalid", defaultColor: "invalid", underline: true, underlineColor: "invalid" }),
      } } }),
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Custom] });
    const ops = await recordDrawOps(() => buildPdf(marked([...names]), editor));
    expect(ops.find(op => op.op === "text")?.["color"]).toBe(expected);
    expect(ops.filter(op => op.op === "line").some(op => op["color"] === expected)).toBe(true);
  });

  it.each([0, 0.7, 1])("explicit opacity %s replaces CSS alpha and paints before text", async opacity => {
    const Custom = Extension.create({
      name: "custom",
      addExports: () => ({ pdf: { marks: {
        custom: () => ({ backgroundColor: { color: "rgba(255, 0, 0, 0.25)", opacity } }),
      } } }),
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Custom] });
    const ops = await recordDrawOps(() => buildPdf(marked(["custom"]), editor));
    const at = ops.findIndex(op => op.op === "text");
    expect(ops[at - 1]).toMatchObject({ op: "rect", color: "rgb(1, 0, 0)", opacity });
  });
});

/**
 * A node type with no PDF handler is skipped. That is survivable only if it is
 * reported, and it has to be reported wherever the node appears — an extension
 * that ships an inline node and forgets its PDF handler otherwise sees it on
 * the canvas and silently missing from the file.
 */
describe("PDF missing handler diagnostics", () => {
  it.each([
    ["a block", () => onePage([block("pageBreak", [])])],
    ["an inline atom", () => {
      const host = block("paragraph", [textLine("before")]);
      host.lines[0]!.spans.push({
        kind: "object",
        node: schema.nodes["pageBreak"]!.createAndFill()!,
        docPos: 1,
        x: 60,
        width: 10,
        height: 10,
        verticalAlign: "baseline",
      });
      return onePage([host]);
    }],
  ])("warns by name for %s", async (_label, makeLayout) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = new ServerEditor({ extensions: [StarterKit] });
    await buildPdf(makeLayout(), editor);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pageBreak"));
    warn.mockRestore();
  });
});

/**
 * The exporter ships no handlers of its own, so a node appears in the file
 * only because the extension that defines it said how to draw it. Dropping
 * that extension has to drop the ink with it, not fall back to something the
 * exporter kept for itself.
 */
describe("PDF node ownership", () => {
  it("draws a horizontal rule only when its extension is present", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rule = () => onePage([block("horizontalRule", [])]);

    const withRule = await recordDrawOps(() =>
      buildPdf(rule(), new ServerEditor({ extensions: [StarterKit] })));
    const withoutRule = await recordDrawOps(() =>
      buildPdf(rule(), new ServerEditor({
        extensions: [StarterKit.configure({ horizontalRule: false })],
      })));

    expect(withRule.filter(op => op.op === "line")).toHaveLength(1);
    expect(withoutRule.filter(op => op.op === "line")).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("horizontalRule"));
    warn.mockRestore();
  });
});
