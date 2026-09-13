import { describe, expect, it, vi } from "vitest";
import { Extension, ServerEditor, StarterKit, type PdfMarkHandler } from "@scrivr/core";
import { buildPdf } from "../index";
import { block, onePage, textLine } from "./fixtures";
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
