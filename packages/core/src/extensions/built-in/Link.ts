import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";

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
        attrs: { href: {}, title: { default: null }, dataTracked: { default: [] } },
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
      setLinkHref:
        (from: unknown, to: unknown, href: unknown) =>
        (state, dispatch) => {
          const markType = this.schema.marks["link"];
          if (!markType) return false;
          if (dispatch) {
            const tr = state.tr.removeMark(from as number, to as number, markType);
            tr.addMark(from as number, to as number, markType.create({ href }));
            dispatch(tr);
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
      decorateFill(_rect, theme) {
        return theme.link;
      },
      decoratePost(ctx, rect, theme, _effectiveTextColor) {
        ctx.save();
        ctx.strokeStyle = theme.link;
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
          open(_state: unknown, _mark: { attrs: Record<string, unknown> }) {
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

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    link: {
      /** Prompt for a URL and apply a link mark to the selection. */
      setLink: () => ReturnType;
      /** Update the href of an existing link at [from, to]. */
      setLinkHref: (from: number, to: number, href: string) => ReturnType;
      /** Remove the link mark from the selection. */
      unsetLink: () => ReturnType;
    };
  }

  interface MarkAttributes {
    link: {
      /** The link href URL */
      href: string;
      /** Optional link title */
      title?: string;
    };
  }
}
