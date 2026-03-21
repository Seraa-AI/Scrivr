import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect, ToolbarItemSpec } from "../types";

interface ColorOptions {
  /** Preset color swatches shown in the toolbar (CSS color strings). */
  colors: string[];
}

const DEFAULT_COLORS = ["#1e293b", "#dc2626", "#2563eb", "#16a34a", "#9333ea", "#ea580c"];

/**
 * Color — inline text color via the `color` mark.
 *
 * Rendering is handled by decorateFill, which returns the CSS color string
 * to use as ctx.fillStyle before fillText. No font metric change required.
 *
 * Commands:
 *   setColor(color: string)  — applies the color mark to the selection
 *   unsetColor()             — removes the color mark from the selection
 */
export const Color = Extension.create<ColorOptions>({
  name: "color",

  defaultOptions: {
    colors: DEFAULT_COLORS,
  },

  addMarks() {
    return {
      color: {
        attrs: { color: {} },
        excludes: "color",
        parseDOM: [
          {
            style: "color",
            getAttrs: (value) => ({ color: value }),
          },
        ],
        toDOM: (mark) => [
          "span",
          { style: `color:${mark.attrs["color"] as string}` },
          0,
        ],
      },
    };
  },

  addCommands() {
    return {
      setColor:
        (color: unknown) =>
        (state, dispatch) => {
          const markType = this.schema.marks["color"];
          if (!markType) return false;
          if (dispatch) {
            const { from, to } = state.selection;
            dispatch(state.tr.addMark(from, to, markType.create({ color })));
          }
          return true;
        },
      unsetColor:
        () =>
        (state, dispatch) => {
          const markType = this.schema.marks["color"];
          if (!markType) return false;
          if (dispatch) {
            const { from, to } = state.selection;
            dispatch(state.tr.removeMark(from, to, markType));
          }
          return true;
        },
    };
  },

  addMarkDecorators() {
    const decorator: MarkDecorator = {
      decorateFill(rect: SpanRect): string | undefined {
        return rect.markAttrs["color"] as string | undefined;
      },
    };
    return { color: decorator };
  },

  addToolbarItems() {
    const colorMeta: Record<string, string> = {
      "#1e293b": "Default",
      "#dc2626": "Red",
      "#2563eb": "Blue",
      "#16a34a": "Green",
      "#9333ea": "Purple",
      "#ea580c": "Orange",
    };

    const items: ToolbarItemSpec[] = this.options.colors.map((color) => ({
      command: "setColor",
      args: [color],
      label: "\u25cf",
      labelStyle: { color, fontSize: 16, lineHeight: 1 },
      title: `${colorMeta[color] ?? color} text`,
      group: "color",
      isActive: (_activeMarks, _blockType, _blockAttrs, activeMarkAttrs) =>
        activeMarkAttrs?.["color"]?.["color"] === color,
    }));
    return items;
  },
});
