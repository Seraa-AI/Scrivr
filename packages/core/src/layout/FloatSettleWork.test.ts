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

/** A paragraph, then an anchor whose top-bottom float sits `yOffset` from it. */
function oscillatingDoc(yOffset: number): Node {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text(`Above ${words}`)]),
    schema.node("paragraph", null, [
      schema.text(`Anchor ${words}`),
      schema.node("image", { src: "", wrapMode: "top-bottom", width: 200, height: 60, yOffset }),
    ]),
  ]);
}

describe("a float with no fixed point", () => {
  it("is locked instead of chasing its anchor until the backstop", () => {
    // Pull the float up over the last line of the paragraph above: clearing
    // that line moves the anchor, which moves the float back over it.
    const plain = runPipeline(
      schema.node("doc", null, [
        schema.node("paragraph", null, [schema.text(`Above ${words}`)]),
        schema.node("paragraph", null, [schema.text("Anchor")]),
      ]),
      { pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer() },
    );
    const [above, anchor] = plain.pages[0]?.blocks ?? [];
    const lastLine = above?.lines.at(-1);
    if (!above || !anchor || !lastLine) throw new Error("plain layout");
    const reachBack = above.y + above.height - lastLine.lineHeight - anchor.y;

    const settled = (yOffset: number): number => {
      counter.calls = 0;
      runPipeline(oscillatingDoc(yOffset), { pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer() });
      return counter.calls;
    };
    // Without the lock the float is placed again on every pass up to the
    // backstop (MAX_SETTLE_PASSES, 64), re-laying the text each time; locked,
    // it costs a few re-layouts more than a float that settles at once.
    expect(settled(reachBack)).toBeLessThan(settled(0) + 10);
  });
});
