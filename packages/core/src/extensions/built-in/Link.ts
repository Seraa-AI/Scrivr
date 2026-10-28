import { Extension } from "../Extension";
import {
  xml,
  type DocxMarkHandler,
  type DocxRunWrapper,
  type DocxMarkTransform,
} from "../../exports/docx";
import type { MarkDecorator, SpanRect } from "../types";
import { safeUrl } from "../../model/safeUrl";
import { getMarkAttrs } from "../../model/getNodeAttrs";
import type { PdfMarkHandler } from "../../exports/pdf";
import type { Mark, MarkType, Node } from "prosemirror-model";

export interface LinkRange {
  href: string;
  from: number;
  to: number;
}

function linkHref(mark: Mark): string | null {
  const href: unknown = mark.attrs["href"];
  return typeof href === "string" ? href : null;
}

function linkTitle(mark: Mark): string | null {
  const title: unknown = mark.attrs["title"];
  return typeof title === "string" ? title : null;
}

/**
 * The link the caret at `pos` is in: the one on the character just before it,
 * as far as that link runs, so a caret just before a link is not in it. A link
 * is where it points, so a run split by other attrs, such as tracking
 * metadata, is still one link.
 */
export function linkAt(doc: Node, pos: number, linkType: MarkType): LinkRange | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  const linkOf = (index: number): Mark | undefined =>
    index >= 0 && index < parent.childCount ? linkType.isInSet(parent.child(index).marks) : undefined;

  const index = $pos.textOffset > 0 ? $pos.index() : $pos.index() - 1;
  const mark = linkOf(index);
  const href = mark ? linkHref(mark) : null;
  if (!mark || href === null) return null;

  const sameLink = (i: number) => {
    const other = linkOf(i);
    return other !== undefined && linkHref(other) === href;
  };
  let first = index;
  let last = index;
  while (sameLink(first - 1)) first--;
  while (sameLink(last + 1)) last++;

  return { href, from: $pos.posAtIndex(first), to: $pos.posAtIndex(last + 1) };
}

function firstLinkIn(doc: Node, from: number, to: number, linkType: MarkType): Mark | undefined {
  const links: Mark[] = [];
  doc.nodesBetween(from, to, (node) => {
    const mark = linkType.isInSet(node.marks);
    if (mark) links.push(mark);
  });
  return links[0];
}

/**
 * Link — inline hyperlink via the `link` mark.
 *
 * Canvas rendering: blue text + blue underline via MarkDecorator. The fill
 * is a default (decorateDefaultFill), so an explicit colour mark overrides it;
 * the underline stays link-blue, drawn by decoratePost.
 *
 * The `setLink` command prompts for a URL via window.prompt so the toolbar
 * button works without needing a separate dialog component.
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
            // Kept simple: an extension registered after this one can replace
            // `setLink` with a real dialog, since the last registration wins.
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
            const replaced = firstLinkIn(state.doc, from, to, markType);
            const title = replaced ? linkTitle(replaced) : null;
            const tr = state.tr.removeMark(from, to, markType);
            tr.addMark(from, to, markType.create({ href: safe, title }));
            dispatch(tr);
          }
          return true;
        },
      unsetLink:
        () =>
        (state, dispatch) => {
          const markType = this.schema.marks["link"];
          if (!markType) return false;
          // Like Word's Remove Hyperlink: a caret removes the link it is in, and
          // a selection removes every link it touches, not just the selected part.
          const { from, to, empty, head } = state.selection;
          const range = empty
            ? linkAt(state.doc, head, markType)
            : {
                from: linkAt(state.doc, from + 1, markType)?.from ?? from,
                to: linkAt(state.doc, to, markType)?.to ?? to,
              };
          if (!range) return false;
          if (dispatch) dispatch(state.tr.removeMark(range.from, range.to, markType));
          return true;
        },
    };
  },

  addMarkDecorators() {
    const decorator: MarkDecorator = {
      // Semantic, not authored: a link is blue because it is a link, so a
      // colour the author actually chose takes precedence over it.
      decorateDefaultFill(_rect, theme) {
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
  addExports() {
    // OOXML expresses a hyperlink as an element wrapping the runs, carrying a
    // relationship id — no run property can produce one, which is why this
    // needs a wrapper as well as a mark handler. Without both, a link reached
    // Word as ordinary text and the export logged an unsupported-mark warning
    // no UI surfaces.
    const style: DocxMarkHandler = (props, _mark, ctx) => ({
      ...props,
      // Word's built-in Hyperlink character style: blue and underlined, and
      // the thing readers recognise as a link.
      styleId: ctx.styles.character.getOrCreate("Hyperlink", {
        color: "0563C1",
        underline: true,
      }),
    });

    const wrap: DocxRunWrapper = (run, mark, ctx) => {
      const href = mark.attrs["href"];
      // A link with no usable href is styled text, not a broken relationship:
      // emitting `r:id` for a rel that was never registered produces a file
      // Word refuses to open.
      if (typeof href !== "string" || href.length === 0) return run;
      return xml("w:hyperlink", { "r:id": ctx.rels.addHyperlink(href) }, [run]);
    };

    // Blue because it is a link, not because anyone chose blue — so an
    // explicit colour wins for the text. The underline stays link-blue either
    // way, matching what the canvas draws.
    const pdfMark: PdfMarkHandler = (mark, ctx) => {
      const href = safeUrl(mark.attrs["href"]);
      return {
        defaultColor: ctx.theme.link,
        underline: true,
        underlineColor: ctx.theme.link,
        ...(href === null ? {} : { link: href }),
      };
    };

    return {
      docx: { marks: { link: style }, markWrappers: { link: wrap } },
      pdf: { marks: { link: pdfMark } },
    };
  },

  addImports() {
    // The mirror of `addExports`' wrapper: the parser turns `<w:hyperlink>`
    // into a `hyperlink` mark carrying the relationship id, and the target
    // itself lives in the part's rels. Without this the mark arrived with no
    // handler, so every link in an imported file became ordinary text.
    const handler: DocxMarkTransform = (mark, ctx) => {
      const attrs = mark.attrs ?? {};
      const relId = attrs["relId"];
      const anchor = attrs["anchor"];

      // Word writes both for an external link into a fragment and resolves
      // them as `target#anchor`. Branch on the resolved target rather than on
      // `relId`, so a relationship that does not resolve falls through to the
      // anchor instead of losing that too.
      const target =
        typeof relId === "string" ? ctx.rels.resolveHyperlink(relId) : undefined;
      const fragment =
        typeof anchor === "string" && anchor.length > 0 ? `#${anchor}` : "";
      const raw = target !== undefined ? `${target}${fragment}` : fragment;

      // A .docx is untrusted input and its rels are an ingestion path like
      // paste, so the same gate applies here.
      const href = raw.length > 0 ? safeUrl(raw) : null;
      const type = ctx.schema.marks["link"];
      if (href === null || !type) {
        // Deliberately not `unsupported-mark`: that code is in the fatal set,
        // so a `file://` share or a dangling rel — both ordinary in real
        // documents — would abort an `unsupported: "throw"` import over a lost
        // target while the text itself came through intact.
        ctx.diagnostics.warn({
          code: "hyperlink-dropped",
          // Names the relationship, not the target: a refused target is a
          // string we kept out of the document, and this message can end up
          // rendered in an app's error surface.
          message: `Hyperlink dropped — no usable target${
            typeof relId === "string" ? ` for ${relId}` : ""
          }`,
          markType: "hyperlink",
        });
        return null;
      }
      return type.create({ href });
    };

    return { docx: { marks: { hyperlink: handler } } };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    link: {
      /** Prompt for a URL and apply a link mark to the selection. */
      setLink: () => ReturnType;
      /** Point the link at [from, to] at `href`, keeping its title. */
      setLinkHref: (from: number, to: number, href: string) => ReturnType;
      /** Remove every link the selection touches, or the link a caret is in. */
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
