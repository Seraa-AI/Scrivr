import { describe, it, expect } from "vitest";
import { TextSelection, NodeSelection, AllSelection, type Selection } from "prosemirror-state";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { SelectionRegistry } from "./SelectionRegistry";
import type { SelectionBehavior } from "./types";

// A behavior only needs matches() for resolution; describe/geometry are stubs.
function behavior(kind: string, matches: (s: Selection) => boolean): SelectionBehavior {
  return {
    kind,
    matches: (s): s is Selection => matches(s),
    describe: () => {
      throw new Error("not exercised");
    },
    geometry: () => [],
  };
}

const textBehavior = behavior("text", (s) => s instanceof TextSelection);
const nodeBehavior = behavior("node", (s) => s instanceof NodeSelection);
const fallback = behavior("fallback", () => true);

function docWithImage(): ServerEditor {
  return new ServerEditor({
    extensions: [StarterKit],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        { type: "image", attrs: { src: "x.png" } },
      ],
    },
  });
}

describe("SelectionRegistry", () => {
  it("resolves the first matching behavior in registration order", () => {
    const editor = docWithImage();
    const registry = new SelectionRegistry([nodeBehavior, textBehavior], fallback);
    const textSel = TextSelection.create(editor.getState().doc, 1);
    expect(registry.resolve(textSel).kind).toBe("text");
  });

  it("returns the fallback for a selection no behavior matches (never unhandled)", () => {
    const editor = docWithImage();
    // Only text + node are registered; AllSelection matches neither.
    const registry = new SelectionRegistry([textBehavior, nodeBehavior], fallback);
    const allSel = new AllSelection(editor.getState().doc);
    expect(registry.resolve(allSel).kind).toBe("fallback");
  });

  it("lets an earlier behavior win over a later overlapping one", () => {
    const editor = docWithImage();
    const first = behavior("first", (s) => s instanceof TextSelection);
    const registry = new SelectionRegistry([first, textBehavior], fallback);
    const textSel = TextSelection.create(editor.getState().doc, 1);
    expect(registry.resolve(textSel).kind).toBe("first");
  });
});
