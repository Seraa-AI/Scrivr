import { Extension } from "../Extension";
import type { MarkDecorator, SpanRect } from "../types";
import { safeUrl } from "../../model/safeUrl";
import { getMarkAttrs } from "../../model/getNodeAttrs";

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
              // dom is typed as `Node | string` from ProseMirror; narrow via
              // `instanceof Element` so we can call getAttribute without a cast.
              if (!(dom instanceof Element)) return false;
              // Reject the mark entirely when the href fails the ingestion
              // allow-list. Returning false from getAttrs drops only the
              // mark — the link text remains as plain text rather than
              // disappearing, which preserves user content while killing
              // the dangerous href. See model/safeUrl.ts.
              const href = safeUrl(dom.getAttribute("href"));
              if (href === null) return false;
              return { href, title: dom.getAttribute("title") };
            },
          },
        ],
        toDOM: (mark) => {
          const { href, title } = getMarkAttrs(mark, "link");
          return ["a", { href, title: title ?? null }, 0];
        },
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
            const raw = window.prompt("Enter URL:", "https://");
            const href = safeUrl(raw);
            if (href === null) return true; // user cancelled or unsafe — no-op
            dispatch(state.tr.addMark(from, to, markType.create({ href })));
          }
          return true;
        },
      setLinkHref:
        (from: unknown, to: unknown, href: unknown) =>
        (state, dispatch) => {
          const markType = this.schema.marks["link"];
          if (!markType) return false;
          // Runtime narrowing on the unknown args — Commands<R> declares
          // the signature as `unknown` so the manager doesn't need each
          // command's parameter shape, but we still want to bail on
          // misuse rather than coerce silently with `as`.
          if (typeof from !== "number" || typeof to !== "number") return false;
          // Validate the inbound href before storing it. Returns false on
          // reject so callers (toolbar, AI accept, collab apply) can detect
          // the rejection rather than silently storing nothing.
          const safe = safeUrl(href);
          if (safe === null) return false;
          if (dispatch) {
            const tr = state.tr.removeMark(from, to, markType);
            tr.addMark(from, to, markType.create({ href: safe }));
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
