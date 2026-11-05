// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, StarterKit, TextMeasurer } from "@scrivr/core";
import type { ResolvedNodeAction, TableMenuOptions, TextMeasureContext } from "@scrivr/core";
import { TableMenu } from "./TableMenu";

/**
 * `<TableMenu>` renders what the controller reports: the peek is the table's
 * shape and nothing to click, full is the editor's node actions. The
 * controller is driven by hand so these tests own when it shows.
 */

const controller = vi.hoisted(() => {
  const state: { options: TableMenuOptions | null } = { options: null };
  return state;
});

vi.mock("@scrivr/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@scrivr/core")>();
  return {
    ...core,
    createTableMenu: (_editor: unknown, options: TableMenuOptions) => {
      controller.options = options;
      return () => {
        controller.options = null;
      };
    },
  };
});

const ANCHOR = new DOMRect(100, 100, 300, 1);

/**
 * happy-dom has no canvas to measure with, and constructing an editor lays the
 * document out. Nothing here reads a width, so every glyph is 8px wide.
 */
const fixedWidthContext: TextMeasureContext = {
  font: "",
  measureText: (text) => ({
    width: text.length * 8,
    actualBoundingBoxAscent: 10,
    actualBoundingBoxDescent: 3,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: text.length * 8,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 4,
    alphabeticBaseline: 0,
    emHeightAscent: 12,
    emHeightDescent: 4,
    hangingBaseline: 10,
    ideographicBaseline: -4,
  }),
};

function action(id: string, group: string, extra: Partial<ResolvedNodeAction> = {}): ResolvedNodeAction {
  return { id, label: id, group, run: () => {}, disabledReason: false, ...extra };
}

describe("<TableMenu>", () => {
  let root: Root;
  let host: HTMLDivElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    editor = new Editor({
      extensions: [StarterKit.configure({ table: true })],
      textMeasurer: new TextMeasurer({ context: fixedWidthContext }),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    editor.destroy();
    vi.restoreAllMocks();
  });

  function show(presentation: "peek" | "full"): void {
    act(() => {
      controller.options!.onShow(ANCHOR, { docPos: 0, rows: 2, columns: 3, headerRow: true, presentation });
    });
  }

  function menu(): HTMLElement | null {
    return document.querySelector('[data-scrivr-popover="table-menu"]');
  }

  it("is hidden until the controller shows it", () => {
    act(() => root.render(<TableMenu editor={editor} />));
    expect(menu()).toBeNull();
  });

  it("peeks the table's shape with no actions", () => {
    const getNodeActions = vi.spyOn(editor, "getNodeActions");
    act(() => root.render(<TableMenu editor={editor} />));
    show("peek");

    expect(menu()?.dataset["presentation"]).toBe("peek");
    expect(menu()?.textContent).toContain("Table · 2 × 3");
    expect(menu()?.textContent).toContain("header row");
    expect(menu()?.querySelectorAll("button")).toHaveLength(0);
    expect(getNodeActions).not.toHaveBeenCalled();
  });

  it("renders the editor's node actions when full, and runs the one pressed", () => {
    vi.spyOn(editor, "getNodeActions").mockReturnValue([
      action("table.addRowAfter", "structure"),
      action("table.delete", "table", { danger: true }),
    ]);
    const run = vi.spyOn(editor, "runNodeAction").mockResolvedValue();
    act(() => root.render(<TableMenu editor={editor} />));
    show("full");

    const buttons = [...(menu()?.querySelectorAll("button") ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(["table.addRowAfter", "table.delete"]);
    expect(buttons[1]!.hasAttribute("data-danger")).toBe(true);
    // One divider before each group.
    expect(menu()?.querySelectorAll('[data-part="divider"]')).toHaveLength(2);

    act(() => {
      buttons[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(run).toHaveBeenCalledWith("table.addRowAfter");
  });

  it("shows a disabled action inert, with its reason", () => {
    vi.spyOn(editor, "getNodeActions").mockReturnValue([
      action("table.delete", "table", { disabledReason: "Locked" }),
    ]);
    const run = vi.spyOn(editor, "runNodeAction").mockResolvedValue();
    act(() => root.render(<TableMenu editor={editor} />));
    show("full");

    const button = menu()!.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Locked");
    act(() => {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves hover off unless asked for", () => {
    act(() => root.render(<TableMenu editor={editor} />));
    expect(controller.options?.hover).toBeUndefined();
    act(() => root.render(<TableMenu editor={null} />));
    act(() => root.render(<TableMenu editor={editor} hover />));
    expect(controller.options?.hover).toBe(true);
  });
});
