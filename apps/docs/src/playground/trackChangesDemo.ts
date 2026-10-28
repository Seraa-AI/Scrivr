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
 * Reach it with `?demo=track-changes`.
 */

const ALICE = "alice";
const AT = 1_760_000_000_000;

let seq = 0;
/** Stable ids: a reload should produce the same document, not a new one. */
const nextId = () => `demo-change-${(seq += 1)}`;

type Record_ = {
  id: string;
  authorID: string;
  operation: "insert" | "delete";
  status: "pending";
  createdAt: number;
  updatedAt: number;
};

const record = (operation: Record_["operation"], authorID = ALICE): Record_ => ({
  id: nextId(),
  authorID,
  operation,
  status: "pending",
  createdAt: AT,
  updatedAt: AT,
});

const text = (value: string) => ({ type: "text", text: value });

/** Text Alice has proposed adding. */
const inserted = (value: string, authorID = ALICE) => ({
  type: "text",
  text: value,
  marks: [{ type: "trackedInsert", attrs: { dataTracked: record("insert", authorID) } }],
});

/** Text Alice has proposed removing — still here, struck through. */
const deleted = (value: string, authorID = ALICE) => ({
  type: "text",
  text: value,
  marks: [{ type: "trackedDelete", attrs: { dataTracked: record("delete", authorID) } }],
});

const p = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: { align: "left" as const },
  content: content.length ? content : undefined,
});

const h = (level: number, value: string) => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});

/** A paragraph Alice has proposed adding whole. */
const insertedParagraph = (...content: unknown[]) => ({
  type: "paragraph",
  attrs: { align: "left" as const, dataTracked: [record("insert")] },
  content,
});

const bulletList = (...items: string[]) => ({
  type: "bulletList",
  content: items.map(value => ({ type: "listItem", content: [p(text(value))] })),
});

const codeBlock = (value: string) => ({
  type: "codeBlock",
  content: [text(value)],
});

const scaleParagraphs = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    p(text(`Scale paragraph ${i + 1}. Select everything below and press Bold.`)),
  );

export const TRACK_CHANGES_DEMO_DOC = {
  type: "doc",
  content: [
    h(1, "Track changes, by hand"),
    p(
      text(
        "You are demo-user. Alice already has pending changes here. Switch the mode " +
          "selector to Suggesting before you edit, and keep the changes panel open.",
      ),
    ),

    h(2, "1 · Cancelling your own suggestion"),
    p(text("Type a word into this paragraph, then delete it again: ")),
    p(text("Nothing of yours is pending here yet.")),

    h(2, "2 · Deleting someone else's suggestion"),
    p(
      text("Alice proposed adding "),
      inserted("this phrase"),
      text(". Select her words and delete them."),
    ),

    h(2, "3 · Deleting what is already struck through"),
    p(
      text("Alice proposed removing "),
      deleted("these words"),
      text(". Select them and delete them again."),
    ),

    h(2, "4 · Reviewing a change something depends on"),
    p(text("Alice proposed this whole paragraph. Type inside it, then reject it:")),
    insertedParagraph(text("A clause Alice would like to add to the agreement.")),

    h(2, "5 · A block that admits no marks"),
    p(text("Delete the code block below, then undo. Nothing should throw.")),
    codeBlock("const settled = review.confirm();"),

    h(2, "6 · Moving a list item"),
    p(
      text(
        "Cut a bullet below and paste it into the paragraph under section 1. In " +
          "Suggesting mode a cut proposes a deletion rather than performing one, so " +
          "the original stays struck through and the paste arrives underlined — the " +
          "text is in both places until someone reviews it.",
      ),
    ),
    bulletList(
      "First bullet — cut this one.",
      "Second bullet stays put.",
      "Third bullet stays put.",
    ),

    h(2, "7 · A document-wide command"),
    p(text("Select from here to the end of the document and press Bold.")),
    ...scaleParagraphs(30),
  ],
};
