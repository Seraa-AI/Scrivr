import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";

const LINK_COLOR = "#2563eb"; // blue-600

/**
 * Link — inline hyperlink via the `link` mark.
 *
 * Canvas rendering: blue text + blue underline via MarkDecorator.
 * The fill color is returned by decorateFill, the underline by decoratePost.
 *
 * The `setLink` command prompts for a URL via window.prompt so the toolbar
 * button works without needing a separate dialog component.
 *
 * Commands:
 *   setLink()    — prompts for URL then applies the link mark to selection
 *   unsetLink()  — removes the link mark from the selection
 */
export const Link = Extension.create({
  name: "link",

  addMarks() {
    return {
      link: {
        attrs: { href: {}, title: { default: null } },
        inclusive: false, // cursor after a link doesn't continue it
        parseDOM: [
          {
            tag: "a[href]",
            getAttrs: (dom) => {
              const el = dom as HTMLAnchorElement;
              return { href: el.getAttribute("href"), title: el.getAttribute("title") };
            },
          },
        ],
        toDOM: (mark) => [
          "a",
          { href: mark.attrs["href"] as string, title: mark.attrs["title"] as string | null },
          0,
        ],
      },
    };
  },

  addCommands() {
    return {
      setLink:
        () =>
        (state, dispatch) => {
          const markType = this.schema.marks["link"];
          if (!markType) return false;
          const { from, to } = state.selection;
          if (from === to) return false; // need a selection
          if (dispatch) {
            // Prompt is intentionally simple — consumers can override with a
            // custom dialog by registering their own setLink command before
            // this extension resolves.
            const href = window.prompt("Enter URL:", "https://");
            if (href) {
              dispatch(state.tr.addMark(from, to, markType.create({ href: href.trim() })));
            }
          }
          return true;
        },
      unsetLink:
        () =>
        (state, dispatch) => {
          const markType = this.schema.marks["link"];
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
      decorateFill(_rect: SpanRect): string {
        return LINK_COLOR;
      },
      decoratePost(ctx: CanvasRenderingContext2D, rect: SpanRect) {
        ctx.save();
        ctx.strokeStyle = LINK_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const underlineY = rect.y + Math.ceil(rect.descent * 0.6);
        ctx.moveTo(rect.x, underlineY);
        ctx.lineTo(rect.x + rect.width, underlineY);
        ctx.stroke();
        ctx.restore();
      },
    };
    return { link: decorator };
  },

  addToolbarItems() {
    return [
      {
        command: "setLink",
        label: "🔗",
        title: "Insert link",
        group: "insert",
        isActive: (marks: string[]) => marks.includes("link"),
      },
      {
        command: "unsetLink",
        label: "⛓‍💥",
        title: "Remove link",
        group: "insert",
        isActive: () => false,
      },
    ];
  },

  addMarkdownSerializerRules() {
    return {
      marks: {
        link: {
          open(_state: unknown, mark: { attrs: Record<string, unknown> }) {
            return "[";
          },
          close(_state: unknown, mark: { attrs: Record<string, unknown> }) {
            return `](${mark.attrs["href"] as string}${mark.attrs["title"] ? ` "${mark.attrs["title"] as string}"` : ""})`;
          },
          mixable: false,
        },
      },
    };
  },
});
