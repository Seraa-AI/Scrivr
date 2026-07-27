import { describe, it, expect } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import { ExtensionManager } from "../ExtensionManager";
import { StarterKit } from "../StarterKit";
import {
  DEFAULT_PARAGRAPH_BORDER,
  outsideBorders,
  type ParagraphBorders,
} from "../../model/paragraphBorders";

function makeContext() {
  const manager = new ExtensionManager([StarterKit]);
  const schema = manager.schema;
  const commands = manager.buildCommands();
  const keymap = manager.buildKeymap();
  const state = EditorState.create({ schema, plugins: manager.buildPlugins() });
  return { schema, commands, keymap, state };
}

type Commands = Record<string, (...args: unknown[]) => Command>;

function run(
  state: EditorState,
  commands: Commands,
  name: string,
  ...args: unknown[]
): EditorState {
  let next = state;
  commands[name]!(...args)(state, (tr) => {
    next = state.apply(tr as Parameters<typeof state.apply>[0]);
  });
  return next;
}

/** Select the whole document so multi-block commands see every block. */
function selectAll(state: EditorState): EditorState {
  const $from = state.doc.resolve(0);
  const $to = state.doc.resolve(state.doc.content.size);
  return state.apply(state.tr.setSelection(TextSelection.between($from, $to)));
}

describe("ParagraphBorders commands (via StarterKit)", () => {
  it("is wired into StarterKit — the commands resolve", () => {
    const { commands } = makeContext();
    expect(typeof commands["setParagraphBorders"]).toBe("function");
    expect(typeof commands["setParagraphBorderSide"]).toBe("function");
    expect(typeof commands["clearParagraphBorders"]).toBe("function");
    expect(typeof commands["setParagraphShading"]).toBe("function");
  });

  it("setParagraphBorders sets the attr on the paragraph", () => {
    const { commands, state } = makeContext();
    const s1 = run(state, commands, "setParagraphBorders", outsideBorders());
    expect(s1.doc.firstChild!.attrs["borders"]).toEqual(outsideBorders());
  });

  it("applies to every selected block", () => {
    const { schema, commands, state } = makeContext();
    const p = schema.nodes["paragraph"]!;
    const doc = state.apply(
      state.tr.replaceWith(0, state.doc.content.size, [
        p.create(null, schema.text("one")),
        p.create(null, schema.text("two")),
      ]),
    );
    const selected = selectAll(doc);
    const next = run(selected, commands, "setParagraphBorders", outsideBorders());
    expect(next.doc.child(0).attrs["borders"]).toEqual(outsideBorders());
    expect(next.doc.child(1).attrs["borders"]).toEqual(outsideBorders());
  });

  it("setParagraphBorderSide toggles one edge without clobbering others", () => {
    const { commands, state } = makeContext();
    const s1 = run(state, commands, "setParagraphBorderSide", "bottom", DEFAULT_PARAGRAPH_BORDER);
    const s2 = run(s1, commands, "setParagraphBorderSide", "top", DEFAULT_PARAGRAPH_BORDER);
    const borders = s2.doc.firstChild!.attrs["borders"] as ParagraphBorders;
    expect(borders.bottom).toBeDefined();
    expect(borders.top).toBeDefined();

    // Removing bottom keeps top.
    const s3 = run(s2, commands, "setParagraphBorderSide", "bottom", undefined);
    const after = s3.doc.firstChild!.attrs["borders"] as ParagraphBorders;
    expect(after.bottom).toBeUndefined();
    expect(after.top).toBeDefined();
  });

  it("clearParagraphBorders collapses to null", () => {
    const { commands, state } = makeContext();
    const s1 = run(state, commands, "setParagraphBorders", outsideBorders());
    const s2 = run(s1, commands, "clearParagraphBorders");
    expect(s2.doc.firstChild!.attrs["borders"]).toBeNull();
  });

  it("setParagraphShading sets and clears the fill", () => {
    const { commands, state } = makeContext();
    const s1 = run(state, commands, "setParagraphShading", { fill: "#ffee88" });
    expect(s1.doc.firstChild!.attrs["shading"]).toEqual({ fill: "#ffee88" });
    const s2 = run(s1, commands, "setParagraphShading", null);
    expect(s2.doc.firstChild!.attrs["shading"]).toBeNull();
  });

  it("applies to headings too (cross-cutting)", () => {
    const { schema, commands, state } = makeContext();
    const h = schema.nodes["heading"]!.create({ level: 2 }, schema.text("Title"));
    const doc = state.apply(state.tr.replaceWith(0, state.doc.content.size, h));
    const next = run(selectAll(doc), commands, "setParagraphBorderSide", "bottom", DEFAULT_PARAGRAPH_BORDER);
    const borders = next.doc.firstChild!.attrs["borders"] as ParagraphBorders;
    expect(borders.bottom).toBeDefined();
  });

  it("Enter carries borders to the new paragraph", () => {
    const { commands, keymap, state } = makeContext();
    const typed = state.apply(state.tr.insertText("Hello"));
    const bordered = run(typed, commands, "setParagraphBorders", outsideBorders());

    const enter = keymap["Enter"]!;
    let next = bordered;
    enter(bordered, (tr) => {
      next = bordered.apply(tr as Parameters<typeof bordered.apply>[0]);
    });

    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).attrs["borders"]).toEqual(outsideBorders());
    expect(next.doc.child(1).attrs["borders"]).toEqual(outsideBorders());
  });

  it("exposes the toolbar items through StarterKit", () => {
    const manager = new ExtensionManager([StarterKit]);
    const titles = manager.buildToolbarItems().map((i) => i.title);
    expect(titles).toContain("All borders");
    expect(titles).toContain("Bottom border");
    expect(titles).toContain("No border");
  });
});
