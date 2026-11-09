import { describe, it, expect, vi } from "vitest";
import type { Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer } from "../test-utils";
import { runPipeline, defaultPageConfig } from "./PageLayout";
import type * as BlockLayoutModule from "./BlockLayout";

/**
 * How much work settling floats costs, counted rather than timed: every
 * `layoutBlock` call is one block laid out. Wall time under parallel test
 * load is too noisy to tell linear from quadratic; a call count is exact.
 */
const counter = vi.hoisted(() => ({ calls: 0 }));

vi.mock("./BlockLayout", async (importOriginal) => {
  const original = await importOriginal<typeof BlockLayoutModule>();
  return {
    ...original,
    layoutBlock: (...args: Parameters<typeof original.layoutBlock>) => {
      counter.calls++;
      return original.layoutBlock(...args);
    },
  };
});

const manager = new ExtensionManager([StarterKit.configure({ table: true })]);
const schema = manager.schema;
const fontConfig = manager.buildBlockStyles();
const words = "word ".repeat(25).trim();

/** Paragraphs that each anchor a float reaching up over the one above. */
function reachBackDoc(n: number): Node {
  return schema.node("doc", null, Array.from({ length: n }, (_, i) => schema.node("paragraph", null, [
    schema.text(`P${i} ${words}`),
    schema.node("image", {
      src: "", wrapMode: "square", xAlign: i % 2 ? "left" : "right", width: 120, height: 30, yOffset: -40,
    }),
  ])));
}

function layoutCalls(n: number): number {
  counter.calls = 0;
  runPipeline(reachBackDoc(n), { pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer() });
  return counter.calls;
}

describe("float settling work", () => {
  it("31: grows linearly with the floats, not with their square", () => {
    const small = layoutCalls(100);
    const large = layoutCalls(400);
    // Linear work grows 4x; quadratic would grow 16x.
    expect(large).toBeLessThan(small * 6);
  });
});
