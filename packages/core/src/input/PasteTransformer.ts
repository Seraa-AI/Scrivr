import {
  DOMParser as PMDOMParser,
  Fragment,
  Mark,
  Slice,
} from "prosemirror-model";
import type { Schema, Node } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { MarkdownParser } from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import type {
  MarkdownBlockRule,
  MarkdownParserTokenSpec,
  PasteTransform,
} from "../extensions/types";
import { insertText } from "../model/commands";
import { recloneDocumentIds } from "../model/assignBlockIds";
import { SLICE_DATA_ATTR } from "./ClipboardSerializer";
import { safeImageUrl } from "../model/safeUrl";

/** Markdown detection heuristic */
// Require intentional block-level structure — mid-sentence asterisks are NOT markdown.
const MARKDOWN_PATTERN = /^(#{1,6} |[*-] |\d+\. |`{3}|---)/m;

// Tokens that markdown-it emits but our schema has no equivalent for.
// These are self-closing inline tokens — { ignore: true } silently skips them.
const IGNORE_TOKENS: Record<string, MarkdownParserTokenSpec> = {
  hardbreak: { ignore: true },
  code_inline: { ignore: true },
  image: { ignore: true },
};

export interface PasteOptions {
  /** Paste the clipboard's text form only, discarding all formatting. */
  preferPlain?: boolean;
}

export interface PasteTransformerOptions {
  /**
   * Turn a pasted image file into the `src` the document will store. Defaults
   * to an inline `data:` URL, which needs no infrastructure but grows the
   * document by the size of the image; apps with somewhere to put bytes supply
   * an uploader that returns a URL instead.
   *
   * Returning null (or throwing) drops the image rather than inserting a broken
   * one. The result still passes the URL gate before it is stored.
   */
  uploadImage?: (file: File) => Promise<string | null>;

  /**
   * Extension-contributed rewrites, applied to every parsed slice before it is
   * inserted. Collected by `ExtensionManager.buildPasteTransforms()`.
   */
  pasteTransforms?: PasteTransform[];
}

/** A synchronous reservation followed by asynchronous image resolution. */
export interface PendingImagePaste {
  /** Inserts stable placeholders at the user's paste selection immediately. */
  insert: Transaction;
  /** Replaces those placeholders with uploaded images, or removes failed ones. */
  resolve: (getState: () => EditorState) => Promise<Transaction | null>;
  /** Removes unresolved placeholders and prevents a later resolution. */
  cancel: (state: EditorState) => Transaction | null;
}

/**
 * Widest a pasted image is allowed to start out. Roughly the content column of
 * an A4 page at 96dpi — a full-screen screenshot pasted at its natural 2560px
 * would otherwise land many times wider than the page it sits on.
 */
const MAX_PASTED_IMAGE_WIDTH = 600;

/** The `image` node's schema defaults, used when an image cannot be measured. */
const DEFAULT_IMAGE_BOX = { width: 200, height: 200 } as const;

/**
 * The box a pasted image is inserted at: its natural size, scaled down
 * proportionally when it is wider than the page can hold.
 */
export function fitPastedImage(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return { ...DEFAULT_IMAGE_BOX };
  }
  if (naturalWidth <= MAX_PASTED_IMAGE_WIDTH) {
    return { width: naturalWidth, height: naturalHeight };
  }
  const scale = MAX_PASTED_IMAGE_WIDTH / naturalWidth;
  return {
    width: MAX_PASTED_IMAGE_WIDTH,
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * PasteTransformer — converts clipboard content into a ProseMirror Transaction.
 *
 * Priority:
 *   1. text/html  → ProseMirror DOMParser (handles bold, headings, lists, etc.)
 *   2. text/plain → prosemirror-markdown MarkdownParser (full CommonMark support)
 *   3. text/plain → legacy line-by-line parser (fallback for unsupported constructs)
 *   4. text/plain → plain text insertion
 */
export class PasteTransformer {
  private readonly md: InstanceType<typeof MarkdownIt>;

  constructor(
    private readonly schema: Schema,
    private readonly extraMarkdownRules: MarkdownBlockRule[] = [],
    private readonly markdownParserTokens: Record<
      string,
      MarkdownParserTokenSpec
    > = {},
    private readonly options: PasteTransformerOptions = {},
  ) {
    // Disable rules that generate tokens our schema can't handle (blockquote, link, image).
    // Their content still renders as plain text — no data loss, just no special formatting.
    this.md = new MarkdownIt({ html: false });
    //TODO: add these to the schema
    this.md.disable(["blockquote", "image", "link"]);
  }

  transform(
    clipboardData: DataTransfer,
    state: EditorState,
    opts: PasteOptions = {},
  ): Transaction | null {
    const html = clipboardData.getData("text/html").trim();
    const plain = clipboardData.getData("text/plain");

    // "Paste without formatting" takes the text exactly as-is: no HTML, and no
    // markdown inference either, since that is formatting the user opted out of.
    if (opts.preferPlain) {
      return plain ? this.fromPlainText(state, plain) : null;
    }

    // An image copied from a file manager arrives as bytes plus a text/plain
    // file path. The bytes are the content the user meant; inserting the path
    // as well would paste the image twice, once as a URL string.
    if (!html && hasImageFile(clipboardData)) return null;

    if (html) {
      try {
        return this.fromHtml(html, state);
      } catch {
        // Fall through to plain text on any parse failure
      }
    }

    if (plain) {
      if (this.looksLikeMarkdown(plain)) {
        try {
          return this.fromMarkdown(plain, state);
        } catch {
          // Fall through to plain text
        }
      }

      //User tansaction to allow undo/redo
      return this.fromPlainText(state, plain);
    }

    return null;
  }

  /** Image files */

  /**
   * Insert images the clipboard carries as raw bytes — a screenshot, or a file
   * dragged in from the desktop. Async because the bytes have to be read (or
   * uploaded) before a `src` exists, so the caller dispatches on resolve;
   * `getState` is read then, not now, so a state that moved on in the meantime
   * is still the one edited.
   *
   * Returns null when there is nothing to insert, including when the clipboard
   * also carries HTML: a web-page image copy puts both an `<img>` and its bytes
   * on the clipboard, and the markup is the better source — it keeps the
   * original URL instead of inlining a second copy of the image.
   */
  prepareImagePaste(
    clipboardData: DataTransfer,
    state: EditorState,
  ): PendingImagePaste | null {
    if (clipboardData.getData("text/html").trim()) return null;

    const imageType = this.schema.nodes["image"];
    if (!imageType) return null;

    const files = imageFiles(clipboardData);
    if (files.length === 0) return null;

    const reservations = files.map(() => {
      const id = crypto.randomUUID();
      return {
        id,
        node: imageType.create({
          src: PENDING_IMAGE_SRC,
          alt: "Uploading image…",
          pendingPasteId: id,
        }),
      };
    });
    const insert = state.tr.replaceSelection(
      new Slice(Fragment.from(reservations.map(({ node }) => node)), 0, 0),
    );

    let cancelled = false;
    const reservationIds = reservations.map(({ id }) => id);
    return {
      insert,
      resolve: async (getState) => {
        if (cancelled) return null;
        const resolved = await this.resolveImageFiles(files);
        if (cancelled) return null;
        return resolveImageReservations(getState(), reservationIds, resolved);
      },
      cancel: (currentState) => {
        cancelled = true;
        return resolveImageReservations(
          currentState,
          reservationIds,
          reservationIds.map(() => null),
        );
      },
    };
  }

  /**
   * Resolve an image paste without placeholders. Kept as a low-level helper for
   * headless callers that can guarantee the supplied state has not moved.
   */
  async transformFiles(
    clipboardData: DataTransfer,
    getState: () => EditorState,
  ): Promise<Transaction | null> {
    if (clipboardData.getData("text/html").trim()) return null;
    const imageType = this.schema.nodes["image"];
    if (!imageType) return null;
    const files = imageFiles(clipboardData);
    if (files.length === 0) return null;
    const resolved = await this.resolveImageFiles(files);

    const nodes: Node[] = [];
    for (const image of resolved) {
      if (image) nodes.push(imageType.create(image));
    }
    if (nodes.length === 0) return null;

    return getState().tr.replaceSelection(new Slice(Fragment.from(nodes), 0, 0));
  }

  private async resolveImageFiles(
    files: readonly File[],
  ): Promise<Array<{ src: string; width: number; height: number } | null>> {
    const upload = this.options.uploadImage ?? readAsDataUrl;
    const sources = await Promise.all(
      files.map((file) =>
        Promise.resolve()
          .then(() => upload(file))
          .catch(() => null),
      ),
    );

    return Promise.all(
      sources.map(async (source) => {
        // App-supplied URLs cross the same ingestion gate as every other image.
        const src = safeImageUrl(source);
        return src === null ? null : { src, ...(await measureImage(src)) };
      }),
    );
  }

  /** Plain text */

  /**
   * Insert text verbatim. Line breaks become paragraph breaks, matching
   * Word/Docs — a run of text pasted into a document is a run of paragraphs,
   * not one paragraph holding newline characters the canvas cannot render.
   * The slice stays open at both ends so the outer lines merge with the text
   * already around the cursor.
   */
  private fromPlainText(state: EditorState, text: string): Transaction | null {
    const paragraph = this.schema.nodes["paragraph"];
    if (!paragraph || !/\r?\n/.test(text)) return insertText(state, text);

    const blocks = text
      .split(/\r?\n/)
      .map((line) =>
        paragraph.create(null, line ? this.schema.text(line) : null),
      );
    return state.tr.replaceSelection(
      this.applyPasteTransforms(new Slice(Fragment.from(blocks), 1, 1)),
    );
  }

  /** HTML */

  private fromHtml(html: string, state: EditorState): Transaction {
    const div = document.createElement("div");
    div.innerHTML = html;
    const recorded = readSliceData(div);
    cleanPastedHtml(div);

    // Use parse() (not parseSlice) so we get a complete document; openness is
    // decided below. parseSlice guesses openStart:1 for all block-level content,
    // which merges the first block into the cursor paragraph and discards that
    // block's attrs (e.g. align:"center").
    // Whitespace in our own slice is document content — "big " copied with its
    // trailing space must paste back with it. Foreign HTML gets the usual
    // collapsing, where that space is only markup formatting.
    const parsed = PMDOMParser.fromSchema(this.schema).parse(div, {
      preserveWhitespace: recorded !== null,
    });
    // Clipboard paste is a clone boundary. Persistent structural IDs identify
    // the source nodes and must never be duplicated into the destination doc.
    const doc = recloneDocumentIds(parsed).doc;

    // Collect only block-level nodes. parse() may produce inline nodes (e.g.
    // hardBreak) at the document level from Google Docs' trailing <br> tags.
    const blockNodes: Node[] = [];
    doc.content.forEach((n) => {
      if (n.isBlock) blockNodes.push(n);
    });
    const fragment = Fragment.from(
      blockNodes.length ? blockNodes : doc.content,
    );

    const slice = this.applyPasteTransforms(buildSlice(fragment, recorded));

    // When pasting into an empty paragraph, replace the whole paragraph so we
    // don't leave a stray empty paragraph before the inserted blocks. Openness
    // is irrelevant here — there is no surrounding text to merge with.
    const { $from } = state.selection;
    if ($from.depth >= 1 && $from.parent.content.size === 0) {
      const blockFrom = $from.before($from.depth);
      const blockTo = $from.after($from.depth);
      return state.tr.replaceWith(blockFrom, blockTo, slice.content);
    }

    return state.tr.replaceSelection(slice);
  }

  /**
   * Run extension-contributed transforms over a parsed slice.
   *
   * Every clipboard flavour funnels through here, so a transform sees the
   * content once regardless of whether it arrived as HTML, markdown or plain
   * text. This is the seam that ProseMirror's `transformPasted` view prop would
   * occupy in a DOM editor — Scrivr has no `EditorView`, so plugin props never
   * run.
   *
   * Pasted image files do not pass through here: they arrive as bytes and
   * become new nodes, not as document content carried over from somewhere else.
   */
  private applyPasteTransforms(slice: Slice): Slice {
    let out = slice;
    for (const transform of this.options.pasteTransforms ?? []) out = transform(out);
    return out;
  }

  /** Markdown */

  private looksLikeMarkdown(text: string): boolean {
    if (MARKDOWN_PATTERN.test(text)) return true;
    for (const line of text.split("\n")) {
      const trimmed = line.trimEnd();
      for (const rule of this.extraMarkdownRules) {
        if (rule.pattern.test(trimmed)) return true;
      }
    }
    return false;
  }

  private fromMarkdown(text: string, state: EditorState): Transaction | null {
    // Try prosemirror-markdown's full parser when we have token handlers
    if (Object.keys(this.markdownParserTokens).length > 0) {
      try {
        const tokens = { ...IGNORE_TOKENS, ...this.markdownParserTokens };
        const parser = new MarkdownParser(this.schema, this.md, tokens);
        const doc = parser.parse(text);
        if (doc) {
          return state.tr.replaceSelection(
            this.applyPasteTransforms(new Slice(doc.content, 0, 0)),
          );
        }
      } catch {
        // Unknown token or schema mismatch — fall through to legacy parser
      }
    }

    // Legacy line-by-line parser (handles extension addMarkdownRules + built-in patterns)
    const nodes = this.parseMarkdownBlocks(text);
    if (nodes.length === 0) return insertText(state, text);
    return state.tr.replaceSelection(
      this.applyPasteTransforms(new Slice(Fragment.from(nodes), 0, 0)),
    );
  }

  /** Legacy line-by-line parser */

  /**
   * Line-by-line block parser. Produces paragraph, heading, bulletList,
   * and orderedList nodes. Inline marks (bold, italic) are handled within
   * paragraph and heading text content.
   *
   * Kept as a fallback for when the MarkdownParser encounters tokens our
   * schema doesn't support (blockquotes, nested structures, etc.).
   */
  private parseMarkdownBlocks(text: string): Node[] {
    const lines = text.split("\n");
    const nodes: Node[] = [];

    let paraLines: string[] = [];

    type ListState = { type: "bullet" | "ordered"; items: string[] };
    let list: ListState | null = null;

    const flushPara = () => {
      if (paraLines.length === 0) return;
      const content = paraLines.join(" ").trim();
      if (content) nodes.push(this.makeParagraph(content));
      paraLines = [];
    };

    const flushList = () => {
      if (!list) return;
      const items = list.items.map((itemText) =>
        this.schema.nodes["listItem"]!.create(
          null,
          this.schema.nodes["paragraph"]!.create(
            null,
            this.parseInline(itemText),
          ),
        ),
      );
      const listType = list.type === "bullet" ? "bulletList" : "orderedList";
      const listNode = this.schema.nodes[listType];
      if (listNode && items.length > 0) {
        nodes.push(listNode.create(null, items));
      }
      list = null;
    };

    for (const raw of lines) {
      const line = raw.trimEnd();

      if (line.trim() === "") {
        flushPara();
        flushList();
        continue;
      }

      // Extension-contributed rules — tried before built-in handlers
      let customMatched = false;
      for (const rule of this.extraMarkdownRules) {
        const match = rule.pattern.exec(line);
        if (match) {
          const node = rule.createNode(
            match,
            this.schema,
            this.parseInline.bind(this),
          );
          if (node) {
            flushPara();
            flushList();
            nodes.push(node);
            customMatched = true;
            break;
          }
        }
      }
      if (customMatched) continue;

      // ATX heading
      const headingMatch = /^(#{1,6}) (.+)/.exec(line);
      if (headingMatch) {
        flushPara();
        flushList();
        const level = headingMatch[1]!.length;
        const content = headingMatch[2]!.trim();
        const headingNode = this.schema.nodes["heading"];
        if (headingNode) {
          nodes.push(headingNode.create({ level }, this.parseInline(content)));
        } else {
          nodes.push(this.makeParagraph(content));
        }
        continue;
      }

      // Bullet list item
      const bulletMatch = /^[*-] (.+)/.exec(line);
      if (bulletMatch) {
        flushPara();
        if (list && list.type !== "bullet") flushList();
        if (!list) list = { type: "bullet", items: [] };
        list.items.push(bulletMatch[1]!);
        continue;
      }

      // Ordered list item
      const orderedMatch = /^\d+\. (.+)/.exec(line);
      if (orderedMatch) {
        flushPara();
        if (list && list.type !== "ordered") flushList();
        if (!list) list = { type: "ordered", items: [] };
        list.items.push(orderedMatch[1]!);
        continue;
      }

      if (list) flushList();
      paraLines.push(line);
    }

    flushPara();
    flushList();

    return nodes;
  }

  private makeParagraph(text: string): Node {
    return this.schema.nodes["paragraph"]!.create(null, this.parseInline(text));
  }

  /**
   * Inline mark parser — handles **bold**, *italic*, __bold__, _italic_.
   */
  private parseInline(text: string): Node[] {
    const nodes: Node[] = [];
    const tokens = text.split(/(\*\*|__|[*_])/);
    const boldMark = this.schema.marks["bold"];
    const italicMark = this.schema.marks["italic"];

    let bold = false;
    let italic = false;

    for (const token of tokens) {
      if (token === "**" || token === "__") {
        if (boldMark) bold = !bold;
        continue;
      }
      if (token === "*" || token === "_") {
        if (italicMark) italic = !italic;
        continue;
      }
      if (!token) continue;

      const marks: Mark[] = [];
      if (bold && boldMark) marks.push(boldMark.create());
      if (italic && italicMark) marks.push(italicMark.create());
      nodes.push(this.schema.text(token, marks));
    }

    return nodes.length > 0 ? nodes : [this.schema.text("\u200B")];
  }
}

/** Image files */

const PENDING_IMAGE_SRC =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

function resolveImageReservations(
  state: EditorState,
  ids: readonly string[],
  images: readonly ({ src: string; width: number; height: number } | null)[],
): Transaction | null {
  const byId = new Map(ids.map((id, index) => [id, images[index] ?? null]));
  const matches: Array<{ pos: number; node: Node; image: { src: string; width: number; height: number } | null }> = [];
  state.doc.descendants((node, pos) => {
    const id = node.attrs["pendingPasteId"];
    if (typeof id === "string" && byId.has(id)) {
      matches.push({ pos, node, image: byId.get(id) ?? null });
    }
  });
  if (matches.length === 0) return null;

  const tr = state.tr;
  for (const { pos, node, image } of matches.sort((a, b) => b.pos - a.pos)) {
    if (image) {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        ...image,
        alt: "",
        pendingPasteId: null,
      });
    } else {
      tr.delete(pos, pos + node.nodeSize);
    }
  }
  tr.setMeta("addToHistory", false);
  return tr;
}

/** Image files on the clipboard, in order. Reading `files` can throw once the event's DataTransfer is detached. */
function imageFiles(clipboardData: DataTransfer): File[] {
  try {
    return Array.from(clipboardData.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
  } catch {
    return [];
  }
}

function hasImageFile(clipboardData: DataTransfer): boolean {
  return imageFiles(clipboardData).length > 0;
}

/** Default `uploadImage` — embed the bytes in the document as a data URL. */
function readAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * How long to wait for a pasted image to decode before inserting it unmeasured.
 * Generous for the case that actually occurs here — an inline `data:` URL, or a
 * URL the app's uploader just wrote — both of which decode near-instantly.
 */
const MEASURE_TIMEOUT_MS = 500;

/**
 * Natural dimensions of an image, scaled to fit the page. Best-effort: when the
 * image can't be decoded — no `Image` constructor, a load error, or a decode
 * that never settles — the schema's default box is used and the user resizes by
 * hand. Measuring must never be what stops the paste from landing.
 */
function measureImage(src: string): Promise<{ width: number; height: number }> {
  const ImageCtor = globalThis.Image;
  if (typeof ImageCtor !== "function") {
    return Promise.resolve({ ...DEFAULT_IMAGE_BOX });
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (box: { width: number; height: number }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(box);
    };
    const timer = setTimeout(
      () => settle({ ...DEFAULT_IMAGE_BOX }),
      MEASURE_TIMEOUT_MS,
    );

    const img = new ImageCtor();
    img.onload = () => settle(fitPastedImage(img.naturalWidth, img.naturalHeight));
    img.onerror = () => settle({ ...DEFAULT_IMAGE_BOX });
    img.src = src;
  });
}

/** Slice openness */

/** Open depths recorded by our own serializer on the copied HTML. */
interface RecordedOpenness {
  openStart: number;
  openEnd: number;
}

function readSliceData(root: HTMLElement): RecordedOpenness | null {
  const el = root.querySelector(`[${SLICE_DATA_ATTR}]`);
  const raw = el?.getAttribute(SLICE_DATA_ATTR);
  if (!raw) return null;
  const [start, end] = raw.split(" ");
  const openStart = Number(start);
  const openEnd = Number(end);
  if (!Number.isInteger(openStart) || !Number.isInteger(openEnd)) return null;
  return { openStart, openEnd };
}

/**
 * Decide how open the pasted slice is at each end — i.e. whether its outer
 * blocks merge into the block under the cursor or stand as blocks of their own.
 *
 * A slice copied out of an editor carries its real open depths, so it round-trips
 * exactly. Foreign HTML carries no such record, and the markup alone is ambiguous:
 * `<p>text</p>` is what both a whole paragraph and a fragment of one look like.
 * There, a block merges only when it is a plain paragraph with default attrs —
 * nothing is lost by folding it into the cursor's block, and Word/Docs likewise
 * paste such text inline. Anything with its own identity (a heading, a list, an
 * aligned paragraph) stays a separate block so its attrs survive.
 */
function buildSlice(
  fragment: Fragment,
  recorded: RecordedOpenness | null,
): Slice {
  if (fragment.childCount === 0) return Slice.empty;

  const openStart = recorded
    ? recorded.openStart
    : mergesIntoNeighbour(fragment.firstChild)
      ? 1
      : 0;
  const openEnd = recorded
    ? recorded.openEnd
    : mergesIntoNeighbour(fragment.lastChild)
      ? 1
      : 0;

  // Clamped at both ends: the recorded depths come off the clipboard, so a
  // hostile page can serve any number. Too deep would exceed the fragment;
  // negative is not a slice at all.
  return new Slice(
    fragment,
    clampOpen(openStart, openDepth(fragment, "start")),
    clampOpen(openEnd, openDepth(fragment, "end")),
  );
}

/**
 * A default-attr paragraph has no identity of its own to preserve. Compared
 * against a freshly-created paragraph: `sameMarkup` ignores content and, given
 * the same marks, reduces to "are all attrs still their defaults?".
 */
function mergesIntoNeighbour(node: Node | null | undefined): boolean {
  if (!node || node.type.name !== "paragraph") return false;
  return node.sameMarkup(node.type.create(null, null, node.marks));
}

function clampOpen(depth: number, max: number): number {
  return Math.max(0, Math.min(depth, max));
}

/** How deep the first/last child chain goes — the ceiling on a valid open depth. */
function openDepth(fragment: Fragment, end: "start" | "end"): number {
  let depth = 0;
  let node = end === "start" ? fragment.firstChild : fragment.lastChild;
  while (node && !node.isText && !node.isLeaf) {
    depth++;
    node = end === "start" ? node.firstChild : node.lastChild;
  }
  return depth;
}

/** Word lists */

/**
 * Word and Outlook emit no `<ul>`/`<ol>`. A list is a run of sibling `<p>`s,
 * each tagged `mso-list:lN levelM lfoK`, whose bullet or number is literal text
 * inside a span Word marks `mso-list:Ignore` — its own signal that consumers
 * should drop the glyph and infer real list structure. Pasted untranslated,
 * a Word list becomes a stack of paragraphs each starting with a stray "·".
 */
const WORD_LIST_STYLE = /mso-list:\s*(l\d+)\s+level(\d+)\s+(lfo\d+)/i;
const WORD_LIST_MARKER = /mso-list:\s*ignore/i;
/** A marker is a number or letter followed by a separator: "1.", "a)", "iv.". Bare "·" or "o" is a bullet. */
const ORDERED_MARKER = /^\s*[0-9a-z]+[.)]/i;

interface WordListItem {
  element: HTMLElement;
  listId: string;
  level: number;
  overrideId: string;
  ordered: boolean;
}

function convertWordLists(root: HTMLElement): void {
  const doc = root.ownerDocument;
  if (!doc) return;

  // Each run starts at a list paragraph whose previous sibling is not one.
  const starts = Array.from(root.querySelectorAll("p")).filter(
    (p) => isWordListItem(p) && !isWordListItem(p.previousElementSibling),
  );

  for (const start of starts) {
    const items: WordListItem[] = [];
    let element: Element | null = start;
    while (isWordListItem(element)) {
      items.push(readWordListItem(element));
      element = element.nextElementSibling;
    }
    for (const run of splitWordListRuns(items)) {
      start.parentNode?.insertBefore(buildWordList(run, doc), start);
    }
    for (const item of items) item.element.remove();
  }
}

function isWordListItem(el: Element | null): el is HTMLElement {
  return (
    el !== null &&
    el.tagName === "P" &&
    WORD_LIST_STYLE.test(el.getAttribute("style") ?? "")
  );
}

/** Read an item's depth and kind, and strip the literal marker glyph from its content. */
function readWordListItem(element: HTMLElement): WordListItem {
  const match = WORD_LIST_STYLE.exec(element.getAttribute("style") ?? "");
  const listId = match?.[1]?.toLowerCase() ?? "l0";
  const level = Number(match?.[2] ?? 1);
  const overrideId = match?.[3]?.toLowerCase() ?? "lfo0";

  let ordered = false;
  for (const span of Array.from(element.querySelectorAll("span"))) {
    if (!WORD_LIST_MARKER.test(span.getAttribute("style") ?? "")) continue;
    ordered = ORDERED_MARKER.test(span.textContent ?? "");
    span.remove();
  }

  return { element, listId, level, overrideId, ordered };
}

/**
 * Consecutive Word paragraphs are not necessarily one list. Word identifies a
 * logical list with both its abstract-list and override ids; a same-level
 * marker-kind change is also a new sibling list, not a continuation whose
 * first marker gets to decide the type for every following item.
 */
function splitWordListRuns(items: readonly WordListItem[]): WordListItem[][] {
  const runs: WordListItem[][] = [];
  for (const item of items) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    const continues =
      previous !== undefined &&
      previous.listId === item.listId &&
      previous.overrideId === item.overrideId &&
      !(previous.level === item.level && previous.ordered !== item.ordered);
    if (continues) run!.push(item);
    else runs.push([item]);
  }
  return runs;
}

/** Build nested `<ul>`/`<ol>` from a flat run of levelled items. */
function buildWordList(items: WordListItem[], doc: Document): HTMLElement {
  const first = items[0]!;
  const outer = doc.createElement(first.ordered ? "ol" : "ul");
  const stack: Array<{ level: number; list: HTMLElement }> = [
    { level: first.level, list: outer },
  ];

  for (const item of items) {
    while (stack.length > 1 && item.level < stack[stack.length - 1]!.level) {
      stack.pop();
    }
    let top = stack[stack.length - 1]!;

    if (item.level > top.level) {
      // A deeper item belongs inside the item above it, which is where HTML
      // (and our listItem's `paragraph block*` content) puts a sublist.
      const nested = doc.createElement(item.ordered ? "ol" : "ul");
      (top.list.lastElementChild ?? top.list).appendChild(nested);
      top = { level: item.level, list: nested };
      stack.push(top);
    }

    const li = doc.createElement("li");
    while (item.element.firstChild) li.appendChild(item.element.firstChild);
    top.list.appendChild(li);
  }

  return outer;
}

/** HTML cleanup */

/**
 * Normalise pasted HTML before handing it to the ProseMirror DOMParser.
 *
 * Handles:
 *  - Google Docs: unwraps the outer `<b id="docs-internal-guid-…">` shell
 *    (font-weight:normal wrapper that carries no semantic weight)
 *  - Non-breaking spaces (\u00A0) → regular spaces so word-joining works
 */
export function cleanPastedHtml(root: HTMLElement): void {
  // Strip non-content elements — Google Docs includes a <style> block with
  // generated CSS classes (.c0 { font-size:11pt; … }) that don't map to our schema.
  root.querySelectorAll("style, meta, link").forEach((el) => el.remove());

  // Word's lists are paragraphs pretending to be list items — rebuild them as
  // real <ul>/<ol> before anything else reads the tree. Runs first because it
  // reads the `mso-list` styles that the CSS stripping below would discard.
  convertWordLists(root);

  // Unwrap Google Docs' outer bold wrapper — <b id="docs-internal-guid-…"
  // style="font-weight:normal"> has no semantic meaning; it's just a container.
  root.querySelectorAll('b[id^="docs-internal-guid"]').forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes));
  });

  // Strip empty paragraphs immediately adjacent to <hr> elements.
  // Google Docs wraps every <hr> with <p><span></span></p> spacers — after
  // pasting these become editable empty paragraphs cluttering the document.
  root.querySelectorAll("hr").forEach((hr) => {
    const prev = hr.previousElementSibling;
    const next = hr.nextElementSibling;
    if (prev?.tagName === "P" && (prev.textContent ?? "").trim() === "")
      prev.remove();
    if (next?.tagName === "P" && (next.textContent ?? "").trim() === "")
      next.remove();
  });

  // Strip CSS properties that are always default/noise — they create spurious
  // marks (color, fontSize, etc.) that pollute the parsed document.
  root.querySelectorAll("[style]").forEach((el) => {
    const s = (el as HTMLElement).style;
    s.removeProperty("background-color");
    s.removeProperty("font-variant");
    s.removeProperty("white-space"); // pre/pre-wrap from Google Docs
    if (s.textDecoration === "none") s.removeProperty("text-decoration");
    if (s.verticalAlign === "baseline") s.removeProperty("vertical-align");
    if (s.color === "rgb(0, 0, 0)" || s.color === "#000000")
      s.removeProperty("color");
    // margin/padding/line-height have no schema equivalent
    // TODO: add these to the schema
    s.removeProperty("line-height");
    s.removeProperty("margin-top");
    s.removeProperty("margin-bottom");
    s.removeProperty("margin-left");
    s.removeProperty("margin-right");
  });

  // Replace non-breaking spaces with regular spaces in all text nodes.
  // Google Docs uses \u00A0 between words which causes word-joining to break.
  const walkTextNodes = (node: ChildNode): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      node.textContent = (node.textContent ?? "").replace(/\u00a0/g, " ");
    } else {
      node.childNodes.forEach(walkTextNodes);
    }
  };
  walkTextNodes(root);
}
