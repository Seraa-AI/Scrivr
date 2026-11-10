/**
 * A document for exercising track changes by hand.
 *
 * Several behaviours only show up when someone *else* already has pending work
 * in the document — deleting another author's proposal, reviewing a change
 * something depends on. Loading a document that already holds Alice's changes
 * makes those reachable with one browser and one user.
 *
 * Initial content is not tracked, so these records load exactly as written.
 *
 * Reach it from the content switch in the playground header, or with
 * `?demo=track-changes`.
 */

import { ALICE_OBJECT_CHANGES, ALICE_STYLE_CHANGES } from "./trackChangesObjects";

const ALICE = "alice";
const AT = 1_760_000_000_000;

let seq = 0;
/** Stable ids: a reload should produce the same document, not a new one. */
const nextId = () => `demo-change-${(seq += 1)}`;

type Operation = "insert" | "delete" | "node_join" | "list_change";

const record = (operation: Operation, extra: Record<string, unknown> = {}) => ({
  id: nextId(),
  authorID: ALICE,
  operation,
  status: "pending",
  createdAt: AT,
  updatedAt: AT,
  ...extra,
});

const text = (value: string) => ({ type: "text", text: value });

/** Text Alice has proposed adding. */
const inserted = (value: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  text: value,
  marks: [{ type: "trackedInsert", attrs: { dataTracked: record("insert", extra) } }],
});

/** Text Alice has proposed removing — still here, struck through. */
const deleted = (value: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  text: value,
  marks: [{ type: "trackedDelete", attrs: { dataTracked: record("delete", extra) } }],
});

const p = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: { align: "left" },
  content: content.length ? content : undefined,
});

/** A paragraph carrying one of Alice's block-level records. */
const recorded = (dataTracked: unknown, ...content: unknown[]) => ({
  type: "paragraph",
  attrs: { align: "left", dataTracked: [dataTracked] },
  content: content.length ? content : undefined,
});

const h = (level: number, value: string) => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});

const item = (paragraph: unknown) => ({ type: "listItem", content: [paragraph] });
const bulletList = (...paragraphs: unknown[]) => ({ type: "bulletList", content: paragraphs.map(item) });

const codeBlock = (value: string) => ({
  type: "codeBlock",
  content: [text(value)],
});

const cell = (value: string) => ({ type: "tableCell", content: [p(text(value))] });
const table = (...rows: string[][]) => ({
  type: "table",
  attrs: { layout: "fixed", grid: [160, 160] },
  content: rows.map(cells => ({ type: "tableRow", content: cells.map(cell) })),
});

const floatingImage = {
  type: "image",
  attrs: {
    src: "https://picsum.photos/seed/suggest/180/120",
    alt: "An image to drag",
    width: 180,
    height: 120,
    wrapMode: "square",
    xAlign: "right",
  },
};

/** One move of Alice's: where the words were, and where they went. */
const ALICE_MOVE = { moveId: "demo-move-1" };

const scaleParagraphs = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    p(text(`Scale paragraph ${i + 1}. Select everything below and press Bold.`)),
  );

export const TRACK_CHANGES_DEMO_DOC = {
  type: "doc",
  content: [
    h(1, "Suggesting, by hand"),
    p(
      text(
        "You are demo-user, in Suggesting mode. Alice already has pending changes here. " +
          "Keep the Changes panel open: every card can be accepted or rejected on its own, " +
          "or with Accept all and Reject all.",
      ),
    ),

    h(2, "1 · Paragraph breaks"),
    recorded(record("node_join"), text("Alice deleted the break at the end of this line,")),
    p(text("so this line joins the one above when her change is accepted.")),
    p(text("Try it: put the caret at the start of this line and press Backspace.")),
    p(text("Then press Enter in the middle of this line, and Backspace again to take it back.")),

    h(2, "2 · Lists"),
    bulletList(
      p(text("An item that was already in the list.")),
      recorded(record("list_change", { oldList: [] }), text("Alice moved this paragraph into the list.")),
      p(text("Another item that was already here.")),
    ),
    p(
      text(
        "Try it: put the caret in an item and toggle bullets or numbering from the toolbar, " +
          "or press Shift-Tab. Each paragraph you move is one list change; rejecting it puts " +
          "the paragraph back where it was.",
      ),
    ),

    h(2, "3 · Moving content"),
    p(text("Alice moved "), deleted("a sentence about moving", ALICE_MOVE), text(" from this line…")),
    p(text("…to this one: "), inserted("a sentence about moving", ALICE_MOVE), text(". It is one card, labelled Moved.")),
    p(
      text(
        "Try it: select a few words, cut them, and paste them somewhere else. The cut and the " +
          "paste become one move. Drag a paragraph, the table, or the image below, and that is " +
          "one move too.",
      ),
    ),

    h(2, "4 · Images and tables"),
    p(
      floatingImage,
      text(
        "Drag the image within the page and the card says Image moved. Drag it to another " +
          "paragraph or page and it is a move like any other.",
      ),
    ),
    table(["Drag this table", "or cut it"], ["and paste it", "elsewhere"]),

    h(2, "5 · Images and other blocks Alice changed"),
    p(
      text(
        "Each of these is one card. Accept or reject them one at a time to see what each " +
          "change does to images, tables, rules, code and headings.",
      ),
    ),
    ...ALICE_OBJECT_CHANGES,

    h(2, "6 · Style changes Alice made"),
    p(
      text(
        "Headings, alignment, indentation, formatting and list numbering. Each change is " +
          "one card; rejecting it puts the old style back.",
      ),
    ),
    ...ALICE_STYLE_CHANGES,

    h(2, "7 · Pasting"),
    p(text("Copy two lines from anywhere and paste them in the middle of this sentence.")),
    p(text("Or paste them on the empty line below:")),
    p(),

    h(2, "8 · Cancelling your own suggestion"),
    p(text("Type a word into this paragraph, then delete it again: nothing of yours stays pending.")),

    h(2, "9 · Deleting someone else's suggestion"),
    p(
      text("Alice proposed adding "),
      inserted("this phrase"),
      text(". Select her words and delete them; her suggestion stays, with your deletion beside it."),
    ),

    h(2, "10 · Deleting what is already struck through"),
    p(
      text("Alice proposed removing "),
      deleted("these words"),
      text(". Select them and delete them again: nothing new is proposed."),
    ),

    h(2, "11 · A change something depends on"),
    p(text("Alice proposed this whole paragraph. Type inside it, then reject it:")),
    recorded(record("insert"), text("A clause Alice would like to add to the agreement.")),

    h(2, "12 · A block that admits no marks"),
    p(text("Delete the code block below, then undo. Nothing should throw.")),
    codeBlock("const settled = review.confirm();"),

    h(2, "13 · An edit that can't be suggested"),
    p(
      text(
        "Some edits can't be recorded as suggestions. Rather than change the text directly, " +
          "the editor stops them and a notice says why and what to do instead.",
      ),
    ),

    h(2, "14 · A document-wide command"),
    p(text("Select from here to the end of the document and press Bold.")),
    ...scaleParagraphs(10),
  ],
};
