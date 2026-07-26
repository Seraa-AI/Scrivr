/**
 * applyRichDiffAsSuggestion — the Rich Semantic Merge write half.
 *
 * The keystone is the zero-text-diff formatting edit: the agent returns rich
 * `spans` for a block whose TEXT is unchanged, and the merge lands the mark
 * difference as one accept/rejectable tracked mark-change — no insert/delete
 * churn. Everything else (inserted text carrying marks, block attrs, untrusted
 * spans, pending-change reconciliation, bottom-to-top range mapping) builds on
 * that. Real `ServerEditor` + `StarterKit` + `TrackChanges`.
 */
import { describe, it, expect } from "vitest";
import { ServerEditor, StarterKit, type InlineSpan } from "@scrivr/core";
import { TrackChanges } from "../TrackChanges";
import { TrackChangesStatus } from "../types";
import { trackChangesPluginKey } from "../engine/trackChangesPlugin";
import { applyRichDiffAsSuggestion, type RichBlockEdit } from "../lib/applyRichDiffAsSuggestion";

const AUTHOR = "ai:Assistant";

function editor(content: Record<string, unknown>) {
  return new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
    content,
  });
}

/** One paragraph, one nodeId. */
function para(nodeId: string, content: Array<Record<string, unknown>>, attrs: Record<string, unknown> = {}) {
  return { type: "doc", content: [{ type: "paragraph", attrs: { nodeId, ...attrs }, content }] };
}

function apply(ed: ServerEditor, edits: RichBlockEdit[], warnings: string[] = []) {
  return applyRichDiffAsSuggestion(ed.getState(), (tr) => ed.applyTransaction(tr), {
    edits,
    authorID: AUTHOR,
    onWarn: (m) => warnings.push(m),
  });
}

function changes(ed: ServerEditor) {
  return trackChangesPluginKey.getState(ed.getState())?.changeSet.changes ?? [];
}

function markChanges(ed: ServerEditor) {
  return changes(ed).filter((c) => c.type === "mark-change");
}

function textChanges(ed: ServerEditor) {
  return changes(ed).filter((c) => c.type === "text-change");
}

describe("applyRichDiffAsSuggestion — formatting-only (keystone)", () => {
  it("adds bold to an existing word with zero text churn", () => {
    const ed = editor(
      para("p", [
        { type: "text", text: "The " },
        { type: "text", text: "Provider" },
        { type: "text", text: " shall pay." },
      ]),
    );
    const before = ed.getState().doc.textContent;

    const spans: InlineSpan[] = [
      { text: "The ", marks: [] },
      { text: "Provider", marks: [{ type: "bold" }] },
      { text: " shall pay.", marks: [] },
    ];
    const res = apply(ed, [{ nodeId: "p", spans }]);

    expect(res.applied).toBe(true);
    expect(ed.getState().doc.textContent).toBe(before); // no text change
    expect(textChanges(ed)).toHaveLength(0);
    const marks = markChanges(ed);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.type === "mark-change" && marks[0]!.mark.type.name).toBe("bold");
    expect(marks[0]!.dataTracked.operation).toBe("insert");
    expect(marks[0]!.type === "mark-change" && marks[0]!.text).toBe("Provider");
  });

  it("removes bold from an existing word as a tracked mark-change", () => {
    const ed = editor(
      para("p", [
        { type: "text", text: "The " },
        { type: "text", text: "Provider", marks: [{ type: "bold" }] },
        { type: "text", text: " shall pay." },
      ]),
    );
    const spans: InlineSpan[] = [{ text: "The Provider shall pay.", marks: [] }];
    const res = apply(ed, [{ nodeId: "p", spans }]);

    expect(res.applied).toBe(true);
    expect(textChanges(ed)).toHaveLength(0);
    const marks = markChanges(ed);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.dataTracked.operation).toBe("delete");
    expect(marks[0]!.type === "mark-change" && marks[0]!.mark.type.name).toBe("bold");
  });

  it("highlights a phrase with no insert/delete churn", () => {
    const ed = editor(
      para("p", [
        { type: "text", text: "Pay within " },
        { type: "text", text: "30 days" },
        { type: "text", text: " of invoice." },
      ]),
    );
    const spans: InlineSpan[] = [
      { text: "Pay within ", marks: [] },
      { text: "30 days", marks: [{ type: "highlight" }] },
      { text: " of invoice.", marks: [] },
    ];
    apply(ed, [{ nodeId: "p", spans }]);

    expect(textChanges(ed)).toHaveLength(0);
    const marks = markChanges(ed);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.dataTracked.operation).toBe("insert");
    expect(marks[0]!.type === "mark-change" && marks[0]!.text).toBe("30 days");
  });
});

describe("applyRichDiffAsSuggestion — text + marks", () => {
  it("inserted text carries the agent's marks; color preserved elsewhere", () => {
    const ed = editor(
      para("p", [
        { type: "text", text: "Pay ", marks: [{ type: "color", attrs: { color: "#f00" } }] },
        { type: "text", text: "soon", marks: [{ type: "color", attrs: { color: "#f00" } }] },
      ]),
    );
    // Replace "soon" → "immediately" and bold the new word; the red color on
    // "Pay " must survive untouched.
    const spans: InlineSpan[] = [
      { text: "Pay ", marks: [{ type: "color", attrs: { color: "#f00" } }] },
      { text: "immediately", marks: [{ type: "bold" }] },
    ];
    const res = apply(ed, [{ nodeId: "p", spans }]);

    expect(res.applied).toBe(true);
    // The inserted "immediately" text node carries bold + trackedInsert.
    let boldInsert = false;
    ed.getState().doc.descendants((n) => {
      if (n.isText && n.text === "immediately") {
        const names = n.marks.map((m) => m.type.name);
        boldInsert = names.includes("bold") && names.includes("trackedInsert");
      }
    });
    expect(boldInsert).toBe(true);
    // "Pay " keeps its red color, untouched by the edit.
    let payRed = false;
    ed.getState().doc.descendants((n) => {
      if (n.isText && n.text?.startsWith("Pay")) {
        payRed = n.marks.some((m) => m.type.name === "color" && m.attrs["color"] === "#f00");
      }
    });
    expect(payRed).toBe(true);
  });

  it("does not leak a link mark onto text inserted next to it", () => {
    const ed = editor(
      para("p", [
        { type: "text", text: "See " },
        { type: "text", text: "the site", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      ]),
    );
    const spans: InlineSpan[] = [
      { text: "See ", marks: [] },
      { text: "the site", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      { text: " now", marks: [] }, // appended plain text, NOT linked
    ];
    apply(ed, [{ nodeId: "p", spans }]);

    let nowLinked = true;
    ed.getState().doc.descendants((n) => {
      if (n.isText && n.text?.includes("now")) {
        nowLinked = n.marks.some((m) => m.type.name === "link");
      }
    });
    expect(nowLinked).toBe(false);
  });
});

describe("applyRichDiffAsSuggestion — block attrs", () => {
  it("changes paragraph alignment as a tracked node-attr-change", () => {
    const ed = editor(para("p", [{ type: "text", text: "Centered." }]));
    const res = apply(ed, [{ nodeId: "p", attrs: { align: "center" } }]);

    expect(res.applied).toBe(true);
    const attrChanges = changes(ed).filter((c) => c.type === "node-attr-change");
    expect(attrChanges).toHaveLength(1);
    expect(attrChanges[0]!.dataTracked.operation).toBe("set_attrs");
  });

  it("ignores an invalid align value (untrusted attr)", () => {
    const ed = editor(para("p", [{ type: "text", text: "x" }]));
    const res = apply(ed, [{ nodeId: "p", attrs: { align: "diagonal" } }]);
    expect(res.applied).toBe(false);
  });
});

describe("applyRichDiffAsSuggestion — untrusted spans", () => {
  it("drops an unknown mark but keeps the inserted text", () => {
    const ed = editor(para("p", [{ type: "text", text: "hello" }]));
    const warnings: string[] = [];
    apply(ed, [{ nodeId: "p", spans: [{ text: "hello world", marks: [{ type: "sparkle" }] }] }], warnings);
    // "hello" kept, " world" inserted; no crash, warned.
    expect(ed.getState().doc.textContent).toContain("hello world");
    expect(warnings.some((w) => w.includes("sparkle"))).toBe(true);
  });

  it("sanitizes a javascript: link href out of inserted text", () => {
    const ed = editor(para("p", [{ type: "text", text: "hi" }]));
    apply(ed, [
      { nodeId: "p", spans: [{ text: "hi ", marks: [] }, { text: "there", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
    ]);
    let anyJsLink = false;
    ed.getState().doc.descendants((n) => {
      if (n.isText) {
        for (const m of n.marks) if (m.type.name === "link" && String(m.attrs["href"]).startsWith("javascript:")) anyJsLink = true;
      }
    });
    expect(anyJsLink).toBe(false);
  });

  it("returns notFound for an unknown nodeId, applies nothing", () => {
    const ed = editor(para("p", [{ type: "text", text: "x" }]));
    const res = apply(ed, [{ nodeId: "ghost", spans: [{ text: "y", marks: [] }] }]);
    expect(res.applied).toBe(false);
    expect(res.notFound).toEqual(["ghost"]);
  });
});

describe("applyRichDiffAsSuggestion — reconciliation + range mapping", () => {
  it("merges cleanly into a block that already has a pending tracked change", () => {
    const ed = editor(
      para("p", [
        { type: "text", text: "Keep " },
        { type: "text", text: "added ", marks: [{ type: "trackedInsert" }] },
        { type: "text", text: "tail" },
      ]),
    );
    // The accepted view is "Keep added tail". Bold "tail" — a formatting-only
    // edit onto a doc that already carries a pending insert must not churn text.
    const spans: InlineSpan[] = [
      { text: "Keep added ", marks: [] },
      { text: "tail", marks: [{ type: "bold" }] },
    ];
    apply(ed, [{ nodeId: "p", spans }]);

    expect(textChanges(ed)).toHaveLength(0);
    const bold = markChanges(ed).filter((c) => c.type === "mark-change" && c.mark.type.name === "bold");
    expect(bold).toHaveLength(1);
  });

  it("fuses adjacent formatting marks applied in separate edits into one change", () => {
    // The live-editing analogue: bold two adjacent words in two transactions.
    // mergeTrackedMarks now unifies formatting marks (not just tracked text),
    // so they group into ONE mark-change — the way typing text already does.
    const ed = editor(para("p", [{ type: "text", text: "one two three" }]));
    const bold = ed.getState().schema.marks.bold!;
    ed.applyTransaction(ed.getState().tr.addMark(1, 4, bold.create())); // "one"
    ed.applyTransaction(ed.getState().tr.addMark(4, 8, bold.create())); // " two"
    const bolds = markChanges(ed).filter((c) => c.type === "mark-change" && c.mark.type.name === "bold");
    expect(bolds).toHaveLength(1);
  });

  it("does NOT fuse adjacent marks with different attrs (two colors stay separate)", () => {
    const ed = editor(para("p", [{ type: "text", text: "red blue" }]));
    const color = ed.getState().schema.marks.color!;
    ed.applyTransaction(ed.getState().tr.addMark(1, 4, color.create({ color: "#f00" }))); // "red"
    ed.applyTransaction(ed.getState().tr.addMark(4, 9, color.create({ color: "#00f" }))); // " blue"
    const colors = markChanges(ed).filter((c) => c.type === "mark-change" && c.mark.type.name === "color");
    expect(colors).toHaveLength(2); // different colors must not merge
  });

  it("dogfood: bold + highlight + realign across blocks with a pending change, no churn", () => {
    // The flagship: a doc that ALREADY carries a pending tracked insert, edited
    // by the agent in three ways at once. Rich intent lands; text is untouched.
    const ed = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { nodeId: "party" }, content: [
            { type: "text", text: "Acme " },
            { type: "text", text: "Corp ", marks: [{ type: "trackedInsert" }] }, // pre-existing pending insert
            { type: "text", text: "and Beta LLC" },
          ] },
          { type: "paragraph", attrs: { nodeId: "clause" }, content: [{ type: "text", text: "Pay within 30 days." }] },
        ],
      },
    });
    const res = apply(ed, [
      // Bold the party names (retained text, spanning the pending insert view).
      { nodeId: "party", spans: [
        { text: "Acme ", marks: [{ type: "bold" }] },
        { text: "Corp ", marks: [{ type: "bold" }] },
        { text: "and Beta LLC", marks: [{ type: "bold" }] },
      ] },
      // Highlight the deadline phrase + right-align the clause.
      { nodeId: "clause", attrs: { align: "right" }, spans: [
        { text: "Pay within ", marks: [] },
        { text: "30 days", marks: [{ type: "highlight" }] },
        { text: ".", marks: [] },
      ] },
    ]);

    expect(res.applied).toBe(true);
    expect(textChanges(ed)).toHaveLength(0); // zero text churn — pure formatting
    // One bold change over the party line (fused across tokens + the pending insert).
    expect(markChanges(ed).filter((c) => c.type === "mark-change" && c.mark.type.name === "bold")).toHaveLength(1);
    expect(markChanges(ed).filter((c) => c.type === "mark-change" && c.mark.type.name === "highlight")).toHaveLength(1);
    expect(changes(ed).filter((c) => c.type === "node-attr-change")).toHaveLength(1);
  });

  it("applies edits to two blocks bottom-to-top without position drift", () => {
    const ed = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "Alpha" }] },
          { type: "paragraph", attrs: { nodeId: "b" }, content: [{ type: "text", text: "Beta" }] },
        ],
      },
    });
    const res = apply(ed, [
      { nodeId: "a", spans: [{ text: "Alpha One", marks: [] }] }, // insert into first block
      { nodeId: "b", spans: [{ text: "Beta Two", marks: [] }] }, // insert into second block
    ]);
    expect(res.applied).toBe(true);
    // Both inserts landed in their correct blocks (no cross-block corruption).
    expect(ed.getState().doc.textContent).toContain("Alpha One");
    expect(ed.getState().doc.textContent).toContain("Beta Two");
  });

  it("inserts rich content into an empty paragraph", () => {
    const ed = editor(para("empty", []));
    const res = apply(ed, [{ nodeId: "empty", spans: [{ text: "New content", marks: [{ type: "bold" }] }] }]);

    expect(res.applied).toBe(true);
    expect(ed.getState().doc.textContent).toBe("New content");
    let insertedText = "";
    let allInsertedTextHasMarks = true;
    ed.getState().doc.descendants((n) => {
      if (n.isText) {
        insertedText += n.text ?? "";
        const names = n.marks.map((m) => m.type.name);
        allInsertedTextHasMarks &&= names.includes("bold") && names.includes("trackedInsert");
      }
    });
    expect(insertedText).toBe("New content");
    expect(allInsertedTextHasMarks).toBe(true);
  });
});

describe("applyRichDiffAsSuggestion — leaf-only guard", () => {
  it("rejects a container (list) target untouched; edits its inner leaf instead", () => {
    const ed = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({ userID: "u1", initialStatus: TrackChangesStatus.enabled })],
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            attrs: { nodeId: "list" },
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", attrs: { nodeId: "li1" }, content: [{ type: "text", text: "Basic tier" }] }],
              },
            ],
          },
        ],
      },
    });
    const before = ed.getState().doc.textContent;
    const warnings: string[] = [];

    const rejectedRes = apply(ed, [{ nodeId: "list", spans: [{ text: "changed", marks: [] }] }], warnings);
    expect(rejectedRes.applied).toBe(false);
    expect(rejectedRes.rejected).toEqual(["list"]);
    expect(ed.getState().doc.textContent).toBe(before); // container untouched
    expect(changes(ed)).toHaveLength(0);
    expect(warnings.some((w) => w.includes("not an editable leaf"))).toBe(true);

    // The inner leaf edits fine by its own nodeId.
    const ok = apply(ed, [{ nodeId: "li1", spans: [{ text: "Basic tier", marks: [{ type: "bold" }] }] }]);
    expect(ok.applied).toBe(true);
    expect(markChanges(ed)).toHaveLength(1);
  });

  it("reports notFound and rejected separately", () => {
    const ed = editor(para("p", [{ type: "text", text: "hi" }]));
    const res = apply(ed, [{ nodeId: "ghost", spans: [{ text: "x", marks: [] }] }]);
    expect(res.applied).toBe(false);
    expect(res.notFound).toEqual(["ghost"]);
    expect(res.rejected).toEqual([]);
  });
});
