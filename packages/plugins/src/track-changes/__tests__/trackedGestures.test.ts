import { describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit, Table } from "@scrivr/core";
import {
  Fragment,
  NodeSelection,
  Slice,
  TextSelection,
  type EditorState,
  type Node as PMNode,
  type Transaction,
} from "@scrivr/core/pm";

import {
  changeActs,
  findChanges,
  reviewChanges,
  TrackChanges,
  TrackChangesStatus,
  trackChangesPluginKey,
} from "../index";
import type { ReviewDecisions, ReviewOutcome, TrackedChange } from "../index";
import { getBlockInlineTrackedData } from "../helpers";

/**
 * Every tracked gesture can be decided. Each scenario runs real editing — key
 * bindings, commands, paste and cut in the shapes the editor builds them — once
 * with tracking off, for the result a reader expects, and once with it on. The
 * tracked run then has to:
 *
 * - leave the caret and selection where the untracked run does;
 * - record anything it changed;
 * - give the untracked result on Accept all, and the original on Reject all;
 * - let every card be decided on its own, either way, or name the dependent
 *   work whose combined decision then applies;
 * - end where the bulk decision does when cards are decided one at a time,
 *   front to back and back to front.
 */

type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string }>;
};

/** A server editor that can also press the editor's own key bindings, tagged as InputBridge tags them. */
class Editor extends ServerEditor {
  press(name: string) {
    const command = this.manager.buildKeymap()[name];
    if (!command) throw new Error(`no binding for ${name}`);
    return command(this.getState(), tr => this.applyTransaction(tr.setMeta("uiEvent", name)));
  }
}

type Scenario = {
  name: string;
  doc: DocNode[];
  gesture: (e: Editor, as: (user: string) => Editor) => Editor | void;
  check?: (e: Editor) => string | null;
};

const p = (text: string): DocNode => text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const h = (text: string): DocNode => ({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] });
const li = (text: string): DocNode => ({ type: "listItem", content: [p(text)] });
const ul = (...items: string[]): DocNode => ({ type: "bulletList", content: items.map(li) });
const bold = (text: string): DocNode => ({ type: "text", text, marks: [{ type: "bold" }] });
const cell = (text: string): DocNode => ({ type: "tableCell", content: [p(text)] });
const table = (...cells: string[]): DocNode => ({ type: "table", content: [{ type: "tableRow", content: cells.map(cell) }] });
const img = (wrapMode = "inline"): DocNode =>
  ({ type: "image", attrs: { src: "data:image/png;base64,AA==", width: 10, height: 10, wrapMode } });
const pWith = (...content: DocNode[]): DocNode => ({ type: "paragraph", content });
const txt = (text: string): DocNode => ({ type: "text", text });
const hr = (): DocNode => ({ type: "horizontalRule" });
const code = (text: string): DocNode => ({ type: "codeBlock", content: [{ type: "text", text }] });

/** Starts from what the editor keeps: a document ending in a paragraph. */
const normalized = (content: DocNode[]) =>
  content[content.length - 1]?.type === "paragraph" ? content : [...content, p("")];

const make = (content: DocNode[], userID: string, tracked: boolean) => new Editor({
  extensions: [
    StarterKit,
    Table,
    TrackChanges.configure({
      userID,
      initialStatus: tracked ? TrackChangesStatus.enabled : TrackChangesStatus.disabled,
      canAcceptReject: true,
    }),
  ],
  content: { type: "doc", content: normalized(content) },
});

// Gestures take the live editor, so positions come from what is there.
const sel = (e: Editor, from: number, to = from) =>
  e.applyTransaction(e.getState().tr.setSelection(TextSelection.create(e.getState().doc, from, to)));
const key = (e: Editor, name: string) => e.press(name);
const tr = (e: Editor, f: (t: Transaction, s: EditorState) => Transaction) =>
  e.applyTransaction(f(e.getState().tr, e.getState()));

/** Where `needle` starts in a block's text, struck or not. Text can be split across nodes. */
function at(e: Editor, needle: string, offset = 0) {
  let found = -1;
  e.getState().doc.descendants((node, pos) => {
    if (found >= 0 || !node.isTextblock) return found < 0;
    let chars = "";
    const positions: number[] = [];
    node.forEach((child, childOffset) => {
      if (!child.isText) return;
      for (let i = 0; i < child.text!.length; i++) {
        chars += child.text![i];
        positions.push(pos + 1 + childOffset + i);
      }
    });
    const index = chars.indexOf(needle);
    if (index >= 0) found = positions[index]! + offset;
    return false;
  });
  if (found < 0) throw new Error(`no ${needle}`);
  return found;
}

/** Where the nth node of a type starts. */
function nodePos(e: Editor, type: string, nth = 0) {
  let found = -1;
  let seen = 0;
  e.getState().doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === type && seen++ === nth) found = pos;
    return true;
  });
  if (found < 0) throw new Error(`no ${type}`);
  return found;
}

const nodeSizeAt = (e: Editor, pos: number) => e.getState().doc.nodeAt(pos)!.nodeSize;

const paragraphs = (s: EditorState, lines: string[]) =>
  Fragment.fromArray(lines.map(line => s.schema.nodes.paragraph!.create(null, line ? s.schema.text(line) : null)));

/** HTML paste on an empty line: the whole block is replaced. */
const pasteIntoEmpty = (e: Editor, lines: string[]) => tr(e, (t, s) => {
  const { $from } = s.selection;
  return t.replaceWith($from.before(), $from.after(), paragraphs(s, lines)).setMeta("uiEvent", "paste");
});

/** Plain-text or HTML paste inside a line: an open slice that merges with the text around it. */
const pasteOpen = (e: Editor, lines: string[]) =>
  tr(e, (t, s) => t.replaceSelection(new Slice(paragraphs(s, lines), 1, 1)).setMeta("uiEvent", "paste"));

/** What the clipboard carries back: content without its tracking records. */
function untracked(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach(node => {
    if (node.isText) {
      nodes.push(node.mark(node.marks.filter(mark => !mark.type.name.startsWith("tracked"))));
    } else {
      const attrs = "dataTracked" in node.attrs ? { ...node.attrs, dataTracked: null } : node.attrs;
      nodes.push(node.type.create(attrs, untracked(node.content), node.marks));
    }
  });
  return Fragment.fromArray(nodes);
}

/** Cut a range: copy it, then delete it the way the cut handler does. */
function cut(e: Editor, from: number, to: number) {
  sel(e, from, to);
  const content = e.getState().selection.content();
  tr(e, t => t.deleteSelection().setMeta("uiEvent", "cut"));
  return new Slice(untracked(content.content), content.openStart, content.openEnd);
}

/** Paste a slice at a caret, through the same two shapes PasteTransformer uses. */
function paste(e: Editor, copied: Slice, pos: number) {
  sel(e, pos);
  tr(e, (t, s) => {
    // The clipboard carries content as data, read back in the pasting editor's schema.
    const slice = Slice.fromJSON(s.schema, copied.toJSON());
    const { $from } = s.selection;
    const pasted = $from.parent.content.size === 0
      ? t.replaceWith($from.before(), $from.after(), slice.content)
      : t.replaceSelection(slice);
    return pasted.setMeta("uiEvent", "paste");
  });
}

/** What a drag commits: Editor.moveNode, or moveAndUpdateNode when placement changes too. */
const dragNode = (e: Editor, docPos: number, target: number, attrs?: Record<string, unknown>) => tr(e, (t, s) => {
  const node = s.doc.nodeAt(docPos)!;
  const $pos = s.doc.resolve(docPos);
  const alone = node.isInline && $pos.parent.isTextblock && $pos.parent.childCount === 1;
  const from = alone ? $pos.before() : docPos;
  const to = alone ? from + $pos.parent.nodeSize : docPos + node.nodeSize;
  t.delete(from, to);
  const insertAt = Math.max(0, Math.min(t.mapping.map(target, -1), t.doc.content.size));
  t.insert(insertAt, attrs ? node.type.create({ ...node.attrs, ...attrs }, node.content, node.marks) : node);
  return t.setSelection(NodeSelection.create(t.doc, insertAt));
});

const pendingOf = (e: Editor): TrackedChange[] => findChanges(e.getState()).pending;
const decide = (e: Editor, decisions: ReviewDecisions) => reviewChanges(e, decisions);
const hasBold = (e: Editor) => JSON.stringify(e.getState().doc.toJSON()).includes('"bold"');

const rejectFormatting = (e: Editor) => {
  const formatting = pendingOf(e).filter(c => c.type === "mark-change").map(c => c.id);
  const outcome = decide(e, { accepted: [], rejected: formatting });
  if (outcome.status !== "applied") return `reject formatting: ${outcome.status}`;
  return hasBold(e) ? `bold remains: ${show(e)}` : null;
};

const acceptInsertRejectFormatting = (e: Editor) => {
  const formatting = pendingOf(e).filter(c => c.type === "mark-change").map(c => c.id);
  const rest = pendingOf(e).filter(c => c.type !== "mark-change").map(c => c.id);
  const outcome = decide(e, { accepted: rest, rejected: formatting });
  if (outcome.status !== "applied") return `accept insert, reject formatting: ${outcome.status}`;
  return hasBold(e) ? `bold remains: ${show(e)}` : null;
};

/** Rejecting a selected image must not leave a different image selected. */
const rejectSelectedImage = (e: Editor) => {
  const pos = nodePos(e, "image");
  e.applyTransaction(e.getState().tr.setSelection(NodeSelection.create(e.getState().doc, pos)));
  const outcome = decide(e, { accepted: [], rejected: pendingOf(e).map(c => c.id) });
  if (outcome.status !== "applied") return `reject: ${outcome.status}`;
  const { selection } = e.getState();
  return selection instanceof NodeSelection ? `selected ${selection.node.type.name} at ${selection.from}` : null;
};

/** The review shows exactly these acts, by kind: "move" when an act links a deletion and an insertion. */
const acts = (...want: string[]) => (e: Editor) => {
  const got = changeActs(pendingOf(e)).map(act =>
    act.records.some(record => record.dataTracked.moveId)
      ? "move"
      : [...new Set(act.records.map(record => record.dataTracked.operation))].sort().join("+"));
  return JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()) ? null : `acts ${JSON.stringify(got)}`;
};

const hello = [p("hello world")];
const digits = [p("0123456789")];

const scenarios: Scenario[] = [
  // Replay frame
  { name: "Enter over selection", doc: hello, gesture: e => { sel(e, 3, 8); key(e, "Enter"); } },
  { name: "delete+insert two steps", doc: hello, gesture: e => tr(e, t => t.delete(3, 8).insertText("X", 3)) },
  { name: "type over one step", doc: hello, gesture: e => { sel(e, 3, 8); tr(e, t => t.insertText("X")); } },
  { name: "delete+insert right", doc: digits, gesture: e => tr(e, t => t.delete(3, 7).insertText("Q", 4)) },
  { name: "insert left then delete", doc: digits, gesture: e => tr(e, t => t.insertText("Q", 2).delete(5, 8)) },
  { name: "delete then insert left", doc: digits, gesture: e => tr(e, t => t.delete(5, 8).insertText("Q", 2)) },
  { name: "two deletions", doc: digits, gesture: e => tr(e, t => t.delete(2, 3).delete(4, 5)) },
  { name: "three deletions reverse", doc: digits, gesture: e => tr(e, t => t.delete(8, 9).delete(5, 6).delete(2, 3)) },
  { name: "delete across blocks+insert", doc: [p("aaaa"), p("bbbb")], gesture: e => tr(e, t => t.delete(3, 9).insertText("Q", 3)) },
  // Composition
  { name: "Enter heading start", doc: [h("title"), p("x")], gesture: e => { sel(e, 1); key(e, "Enter"); } },
  { name: "Enter heading mid", doc: [h("title"), p("x")], gesture: e => { sel(e, 3); key(e, "Enter"); } },
  { name: "Enter heading end", doc: [h("title"), p("x")], gesture: e => { sel(e, 6); key(e, "Enter"); } },
  { name: "Enter empty paragraph", doc: [p("a"), p(""), p("b")], gesture: e => { sel(e, 4); key(e, "Enter"); } },
  { name: "Enter para end", doc: hello, gesture: e => { sel(e, 12); key(e, "Enter"); } },
  { name: "Enter para mid", doc: hello, gesture: e => { sel(e, 6); key(e, "Enter"); } },
  { name: "bold across insertion", doc: hello, gesture: e => tr(e, (t, s) => t.insertText("abc", 5).addMark(2, 12, s.schema.marks.bold!.create())), check: rejectFormatting },
  { name: "bold across, keep insert reject bold", doc: hello, gesture: e => tr(e, (t, s) => t.insertText("abc", 5).addMark(2, 12, s.schema.marks.bold!.create())), check: acceptInsertRejectFormatting },
  { name: "insert at insertion's right edge", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).insertText("Z", 8)) },
  { name: "insert at insertion's left edge", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).insertText("Z", 5)) },
  { name: "unbold across insertion of bold", doc: [{ type: "paragraph", content: [bold("hello world")] }], gesture: e => tr(e, (t, s) => t.insertText("abc", 5).removeMark(2, 12, s.schema.marks.bold!)) },
  { name: "insert block, wrap it and neighbour", doc: [p("one")], gesture: e => tr(e, (t, s) => t.insert(5, s.schema.nodes.paragraph!.create(null, s.schema.text("two")))) },
  { name: "bold inside insertion", doc: hello, gesture: e => tr(e, (t, s) => t.insertText("abc", 5).addMark(6, 7, s.schema.marks.bold!.create())) },
  { name: "delete inside insertion", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).delete(6, 7)) },
  { name: "delete across insertion edge", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).delete(3, 7)) },
  { name: "delete across insertion's right edge", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).delete(7, 10)) },
  { name: "delete over a whole insertion", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).delete(3, 10)) },
  { name: "replace text across insertion edge", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).insertText("Z", 3, 7)) },
  { name: "delete from insertion into next paragraph", doc: [p("one"), p("two")], gesture: e => tr(e, t => t.insertText("abc", 4).delete(5, 9)) },
  { name: "insert then delete all of it", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).delete(5, 8)) },
  { name: "insert, delete all of it, delete after", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).delete(8, 10).delete(5, 8)) },
  { name: "insert, delete after, then all of it", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).delete(5, 8).delete(5, 7)) },
  { name: "insert inside insertion", doc: hello, gesture: e => tr(e, t => t.insertText("abc", 5).insertText("Z", 6)) },
  { name: "insert block then type inside", doc: hello, gesture: e => tr(e, (t, s) => { const end = s.doc.content.size; return t.insert(end, s.schema.nodes.paragraph!.create(null, s.schema.text("draft"))).insertText("Q", end + 3); }) },
  // Caret
  { name: "caret inside inserted ()", doc: hello, gesture: e => { sel(e, 3); tr(e, t => t.insertText("()", 3).setSelection(TextSelection.create(t.doc, 4))); } },
  { name: "insertTable caret", doc: hello, gesture: e => { sel(e, 3); e.commands.insertTable({ rows: 2, cols: 2 }); } },
  { name: "inserted rule", doc: hello, gesture: e => { sel(e, 3); e.commands.insertHorizontalRule(); } },
  { name: "select inserted text", doc: hello, gesture: e => { tr(e, t => t.insertText("abc", 3).setSelection(TextSelection.create(t.doc, 3, 6))); } },
  { name: "type", doc: hello, gesture: e => { sel(e, 3); tr(e, t => t.insertText("Z")); } },
  { name: "Backspace", doc: hello, gesture: e => { sel(e, 3); key(e, "Backspace"); } },
  { name: "forward Delete", doc: hello, gesture: e => { sel(e, 3); key(e, "Delete"); } },
  { name: "node selection of inserted image", doc: hello, gesture: e => { tr(e, (t, s) => { const img = s.schema.nodes.image!.create({ src: "data:image/png;base64,AA==" }); t.insert(3, img); return t.setSelection(NodeSelection.create(t.doc, 3)); }); } },
  { name: "selection set away from edit", doc: hello, gesture: e => { tr(e, t => t.insertText("abc", 9).setSelection(TextSelection.create(t.doc, 2))); } },
  { name: "caret after edit moved right", doc: hello, gesture: e => { tr(e, t => t.insertText("abc", 3).setSelection(TextSelection.create(t.doc, 10))); } },
  // Deletion policy
  { name: "unbold then delete", doc: [{ type: "paragraph", content: [bold("hello world")] }], gesture: e => { sel(e, 3, 8); key(e, "Mod-b"); sel(e, 3, 8); key(e, "Backspace"); } },
  { name: "bold then delete", doc: hello, gesture: e => { sel(e, 3, 8); key(e, "Mod-b"); sel(e, 3, 8); key(e, "Backspace"); } },
  // Review executor
  { name: "Enter then align new block", doc: hello, gesture: e => { sel(e, 6); key(e, "Enter"); sel(e, at(e, "world", 1)); e.commands.setAlignCenter(); } },
  { name: "Enter then align source block", doc: hello, gesture: e => { sel(e, 6); key(e, "Enter"); sel(e, 3); e.commands.setAlignCenter(); } },
  { name: "Enter then heading new block", doc: hello, gesture: e => { sel(e, 6); key(e, "Enter"); sel(e, at(e, "world", 1)); e.commands.setHeading1(); } },
  { name: "toggle list", doc: hello, gesture: e => { sel(e, 3); e.commands.toggleBulletList(); } },
  { name: "toggle list two paragraphs", doc: [p("one"), p("two")], gesture: e => { sel(e, 2, 7); e.commands.toggleBulletList(); } },
  { name: "toggle list off", doc: [ul("one", "two")], gesture: e => { sel(e, 3); e.commands.toggleBulletList(); } },
  { name: "foreign bold from inserted break", doc: hello, gesture: (e, as) => { sel(e, 3); key(e, "Shift-Enter"); const b = as("bob"); sel(b, 3, 8); key(b, "Mod-b"); return b; } },
  { name: "foreign bold from inserted text", doc: hello, gesture: (e, as) => { sel(e, 3); tr(e, t => t.insertText("abc")); const b = as("bob"); sel(b, 3, 10); key(b, "Mod-b"); return b; } },
  // Ordinary commands nobody generated
  { name: "heading last paragraph", doc: [p("one"), p("two")], gesture: e => { sel(e, 7); e.commands.setHeading1(); } },
  { name: "heading only paragraph", doc: [p("one")], gesture: e => { sel(e, 2); e.commands.setHeading1(); } },
  { name: "Tab in list", doc: [ul("one", "two")], gesture: e => { sel(e, 9); key(e, "Tab"); } },
  { name: "Shift-Tab in list", doc: [ul("one", "two")], gesture: e => { sel(e, 9); key(e, "Shift-Tab"); } },
  { name: "Enter in list item", doc: [ul("one", "two")], gesture: e => { sel(e, 5); key(e, "Enter"); } },
  { name: "Enter on empty item", doc: [ul("one", "")], gesture: e => { sel(e, 9); key(e, "Enter"); } },
  { name: "Backspace joins paragraphs", doc: [p("one"), p("two")], gesture: e => { sel(e, 6); key(e, "Backspace"); } },
  { name: "Delete joins paragraphs", doc: [p("one"), p("two")], gesture: e => { sel(e, 4); key(e, "Delete"); } },
  { name: "two-line paste", doc: hello, gesture: e => { sel(e, 3); tr(e, (t, s) => t.replaceSelection(new Slice(Fragment.fromArray([s.schema.nodes.paragraph!.create(null, s.schema.text("FOO")), s.schema.nodes.paragraph!.create(null, s.schema.text("BAR"))]), 1, 1)).setMeta("uiEvent", "paste")); } },
  { name: "Shift-Enter", doc: hello, gesture: e => { sel(e, 3); key(e, "Shift-Enter"); } },
  { name: "Mod-b selection", doc: hello, gesture: e => { sel(e, 3, 8); key(e, "Mod-b"); } },
  { name: "code block toggle", doc: hello, gesture: e => { sel(e, 3); e.commands.toggleCodeBlock(); } },
  { name: "delete whole paragraph range", doc: [p("one"), p("two"), p("three")], gesture: e => tr(e, t => t.delete(5, 10)) },
  { name: "two-block move", doc: [p("aa"), p("bb"), p("cc")], gesture: e => tr(e, (t, s) => { const a = s.doc.child(1); const b = s.doc.child(2); return t.delete(4, 12).insert(0, Fragment.fromArray([a, b])); }) },
  { name: "one-block move", doc: [p("aa"), p("bb"), p("cc")], gesture: e => tr(e, (t, s) => { const b = s.doc.child(1); return t.delete(4, 8).insert(0, b); }) },
  { name: "move a block down", doc: [p("aa"), p("bb"), p("cc")], gesture: e => tr(e, (t, s) => { const a = s.doc.child(0); return t.insert(s.doc.child(0).nodeSize + s.doc.child(1).nodeSize + s.doc.child(2).nodeSize, a).delete(0, a.nodeSize); }) },
  { name: "move three blocks up", doc: [p("aa"), p("bb"), p("cc"), p("dd")], gesture: e => tr(e, (t, s) => { const nodes = [s.doc.child(1), s.doc.child(2), s.doc.child(3)]; return t.delete(4, 16).insert(0, Fragment.fromArray(nodes)); }) },
  { name: "move a block, then type in it", doc: [p("aa"), p("bb"), p("cc")], gesture: e => { tr(e, (t, s) => { const b = s.doc.child(1); return t.delete(4, 8).insert(0, b); }); tr(e, t => t.insertText("X", 2)); } },
  { name: "replace paragraph with text across", doc: [p("aaaa"), p("bbbb")], gesture: e => { sel(e, 3, 9); tr(e, t => t.insertText("X")); } },
  { name: "Enter then Backspace", doc: hello, gesture: e => { sel(e, 6); key(e, "Enter"); key(e, "Backspace"); } },
  { name: "Backspace twice across paragraphs", doc: [p("one"), p("two")], gesture: e => { sel(e, 6); key(e, "Backspace"); key(e, "Backspace"); } },
  { name: "Backspace then type", doc: [p("one"), p("two")], gesture: e => { sel(e, 6); key(e, "Backspace"); tr(e, t => t.insertText("X")); } },
  { name: "Backspace heading into paragraph", doc: [p("one"), h("two")], gesture: e => { sel(e, 6); key(e, "Backspace"); } },
  { name: "Backspace after empty paragraph", doc: [p(""), p("two")], gesture: e => { sel(e, 3); key(e, "Backspace"); } },
  { name: "select across paragraphs and type", doc: [p("one"), p("two")], gesture: e => { sel(e, 3, 7); tr(e, t => t.insertText("X")); } },
  { name: "delete across three paragraphs", doc: [p("one"), p("two"), p("three")], gesture: e => tr(e, t => t.delete(3, 13)) },
  { name: "Backspace someone else's break", doc: hello, gesture: (e, as) => { sel(e, 6); key(e, "Enter"); const b = as("bob"); sel(b, 8); key(b, "Backspace"); return b; } },
  { name: "Backspace into a paragraph I added", doc: [p("one"), p("two")], gesture: e => { sel(e, 4); key(e, "Enter"); tr(e, t => t.insertText("new")); sel(e, at(e, "two")); key(e, "Backspace"); } },
  // Lists
  { name: "bullet list to numbered", doc: [ul("one", "two")], gesture: e => { sel(e, 3, 10); e.commands.toggleOrderedList(); } },
  { name: "Tab twice", doc: [ul("one", "two", "three")], gesture: e => { sel(e, at(e, "three")); key(e, "Tab"); sel(e, at(e, "three")); key(e, "Tab"); } },
  { name: "Shift-Tab a nested item", doc: [ul("one", "two")], gesture: e => { sel(e, at(e, "two")); key(e, "Tab"); sel(e, at(e, "two")); key(e, "Shift-Tab"); } },
  { name: "list off the middle item", doc: [ul("one", "two", "three")], gesture: e => { sel(e, at(e, "two")); e.commands.toggleBulletList(); } },
  { name: "Tab then type in the item", doc: [ul("one", "two")], gesture: e => { sel(e, at(e, "two")); key(e, "Tab"); tr(e, t => t.insertText("X")); } },
  { name: "list on, then Enter and type", doc: [p("one")], gesture: e => { sel(e, 4); e.commands.toggleBulletList(); key(e, "Enter"); tr(e, t => t.insertText("two")); } },
  { name: "list on a paragraph after a list", doc: [ul("one"), p("two")], gesture: e => { sel(e, at(e, "two")); e.commands.toggleBulletList(); } },
  { name: "Bob tabs Alice's new item", doc: [ul("one", "two")], gesture: (e, as) => { sel(e, at(e, "two", 3)); key(e, "Enter"); tr(e, t => t.insertText("new")); const b = as("bob"); sel(b, at(b, "new")); key(b, "Tab"); return b; } },
  // Moving and cutting other kinds of content
  { name: "drag an inline image along its line", doc: [pWith(txt("ab"), img(), txt("cd"))], gesture: e => dragNode(e, nodePos(e, "image"), at(e, "cd", 2)) },
  { name: "drag an inline image to another paragraph", doc: [pWith(txt("ab"), img(), txt("cd")), p("ef")], gesture: e => dragNode(e, nodePos(e, "image"), at(e, "ef", 1)) },
  { name: "drag a floating image on its page", doc: [pWith(img("square"), txt("ab")), p("cd")], gesture: e => tr(e, (t, s) => { const pos = nodePos(e, "image"); return t.setNodeMarkup(pos, undefined, { ...s.doc.nodeAt(pos)!.attrs, yOffset: 40 }); }) },
  { name: "drag a floating image to another page", doc: [pWith(img("square"), txt("ab")), p("cd")], gesture: e => dragNode(e, nodePos(e, "image"), at(e, "cd"), { yOffset: 0 }) },
  { name: "drag a floating image alone in its paragraph", doc: [pWith(img("square")), p("ab"), p("cd")], gesture: e => dragNode(e, nodePos(e, "image"), at(e, "cd")) },
  { name: "drag a table to the top", doc: [p("aa"), table("x", "y"), p("bb")], gesture: e => dragNode(e, nodePos(e, "table"), 0) },
  { name: "drag a horizontal rule", doc: [p("aa"), hr(), p("bb"), p("cc")], gesture: e => dragNode(e, nodePos(e, "horizontalRule"), nodePos(e, "paragraph", 2)) },
  { name: "drag a heading down", doc: [h("title"), p("aa"), p("bb")], gesture: e => dragNode(e, 0, nodePos(e, "paragraph", 1) + 4) },
  { name: "drag a code block up", doc: [p("aa"), code("x = 1"), p("bb")], gesture: e => dragNode(e, nodePos(e, "codeBlock"), 0) },
  { name: "drag a whole list down", doc: [ul("one", "two"), p("aa"), p("bb")], gesture: e => dragNode(e, 0, nodePos(e, "paragraph", 3) + 4) },
  { name: "cut an inline image, paste elsewhere", doc: [pWith(txt("ab"), img(), txt("cd")), p("ef")], gesture: e => { const pos = nodePos(e, "image"); const s = cut(e, pos, pos + 1); paste(e, s, at(e, "ef", 1)); } },
  { name: "cut a table, paste at the top", doc: [p("aa"), table("x", "y"), p("bb")], gesture: e => { const pos = nodePos(e, "table"); const s = cut(e, pos, pos + nodeSizeAt(e, pos)); paste(e, s, 1); } },
  { name: "cut a rule, paste lower", doc: [p("aa"), hr(), p("bb"), p("cc")], gesture: e => { const pos = nodePos(e, "horizontalRule"); const s = cut(e, pos, pos + 1); paste(e, s, at(e, "cc", 2)); } },
  { name: "drag a word along its line", doc: hello, gesture: e => tr(e, (t, s) => { const word = s.doc.slice(1, 7); return t.delete(1, 7).insert(t.mapping.map(12), word.content); }) },
  { name: "drag a word to another paragraph", doc: [p("one two"), p("three")], gesture: e => tr(e, (t, s) => { const word = s.doc.slice(1, 5); return t.delete(1, 5).insert(t.mapping.map(15), word.content); }) },
  // Found in review
  { name: "Delete two breaks in a row", doc: [p("aa"), p("bb"), p("cc")], gesture: e => { sel(e, at(e, "aa", 2)); key(e, "Delete"); sel(e, at(e, "bb", 2)); key(e, "Delete"); } },
  { name: "Backspace a selection across two list items", doc: [ul("one", "two")], gesture: e => { sel(e, 4, 11); key(e, "Backspace"); } },
  { name: "Enter, then Delete at the end of the first half", doc: hello, gesture: e => { sel(e, 6); key(e, "Enter"); sel(e, 6); key(e, "Delete"); } },
  { name: "list off next to another list", doc: [{ ...ul("a"), attrs: { nodeId: "list-a" } }, { ...ul("b"), attrs: { nodeId: "list-b" } }], gesture: e => { sel(e, at(e, "b")); e.commands.toggleBulletList(); } },
  { name: "paste a cut beside text I typed", doc: [p("xyz hello")], gesture: e => { const s = cut(e, at(e, "hello"), at(e, "hello", 5)); tr(e, t => t.insertText("abc", at(e, "xyz", 3))); paste(e, s, at(e, "abc", 3)); }, check: acts("move", "insert") },
  { name: "reject a selected inserted image beside another", doc: [pWith(txt("ab"), img())], gesture: e => tr(e, (t, s) => t.insert(3, s.schema.nodes.image!.create({ src: "data:image/png;base64,BB==" }))), check: rejectSelectedImage },
  { name: "insert a paragraph, delete across its start", doc: hello, gesture: e => tr(e, (t, s) => t.insert(5, s.schema.nodes.paragraph!.create(null, s.schema.text("two"))).delete(3, 8)) },
  { name: "insert a paragraph mid-line", doc: hello, gesture: e => tr(e, (t, s) => t.insert(5, s.schema.nodes.paragraph!.create(null, s.schema.text("two")))) },
  // Style changes
  { name: "colour words", doc: hello, gesture: e => tr(e, (t, s) => t.addMark(1, 6, s.schema.marks.color!.create({ color: "#dc2626" }))) },
  { name: "make words larger", doc: hello, gesture: e => tr(e, (t, s) => t.addMark(1, 6, s.schema.marks.fontSize!.create({ size: 20 }))) },
  { name: "link words", doc: hello, gesture: e => tr(e, (t, s) => t.addMark(1, 6, s.schema.marks.link!.create({ href: "https://scrivr.dev" }))) },
  { name: "highlight words", doc: hello, gesture: e => tr(e, (t, s) => t.addMark(1, 6, s.schema.marks.highlight!.create())) },
  { name: "heading one level smaller", doc: [h("title"), p("x")], gesture: e => tr(e, (t, s) => t.setNodeMarkup(0, undefined, { ...s.doc.child(0).attrs, level: 2 })) },
  { name: "heading back to a paragraph", doc: [h("title"), p("x")], gesture: e => tr(e, (t, s) => t.setNodeMarkup(0, s.schema.nodes.paragraph)) },
  { name: "centre a paragraph", doc: hello, gesture: e => { sel(e, 3); e.commands.setAlignCenter(); } },
  { name: "indent a paragraph", doc: hello, gesture: e => tr(e, (t, s) => t.setNodeMarkup(0, undefined, { ...s.doc.child(0).attrs, indent: 1 })) },
  // Cut and paste
  { name: "cut, type elsewhere, then paste", doc: [p("one two"), p("three")], gesture: e => { const s = cut(e, 1, 5); tr(e, t => t.insertText("X", at(e, "three"))); paste(e, s, at(e, "three", 5)); }, check: acts("move", "insert") },
  { name: "cut, paste, undo the paste, paste again", doc: [p("one two"), p("three")], gesture: e => { const s = cut(e, 1, 5); paste(e, s, at(e, "three", 5)); e.commands.undo(); paste(e, s, at(e, "three", 5)); }, check: acts("move") },
  { name: "paste one cut twice", doc: [p("one two"), p("three")], gesture: e => { const s = cut(e, 1, 5); paste(e, s, at(e, "three", 5)); paste(e, s, at(e, "three")); }, check: acts("move", "insert") },
  { name: "cut, paste something else", doc: [p("one two"), p("three")], gesture: e => { cut(e, 1, 5); pasteOpen(e, ["zz"]); }, check: acts("delete", "insert") },
  { name: "Alice cuts, Bob pastes", doc: [p("one two"), p("three")], gesture: (e, as) => { const s = cut(e, 1, 5); const b = as("bob"); paste(b, s, at(b, "three", 5)); return b; }, check: acts("delete", "insert") },
  { name: "cut a table, paste it back", doc: [p("aa"), table("x", "y"), p("bb")], gesture: e => { const pos = nodePos(e, "table"); const s = cut(e, pos, pos + nodeSizeAt(e, pos)); paste(e, s, at(e, "bb", 2)); }, check: acts("move") },
  { name: "cut a word and paste it back", doc: hello, gesture: e => { const s = cut(e, 1, 7); paste(e, s, 1); } },
  { name: "cut a word, paste later in the line", doc: hello, gesture: e => { const s = cut(e, 1, 7); paste(e, s, at(e, "world", 5)); } },
  { name: "cut a word, paste in another paragraph", doc: [p("one two"), p("three")], gesture: e => { const s = cut(e, 1, 5); paste(e, s, at(e, "three", 5)); } },
  { name: "cut a paragraph, paste above", doc: [p("aa"), p("bb"), p("cc")], gesture: e => { const s = cut(e, 4, 8); paste(e, s, 1); } },
  { name: "cut across two paragraphs, paste elsewhere", doc: [p("one two"), p("three four"), p("five")], gesture: e => { const s = cut(e, 5, 16); paste(e, s, at(e, "five", 4)); } },
  { name: "cut a word, paste into an empty line", doc: [p("one two"), p(""), p("three")], gesture: e => { const s = cut(e, 4, 8); paste(e, s, at(e, "three") - 2); } },
  { name: "cut my own insertion, paste elsewhere", doc: hello, gesture: e => { sel(e, 6); tr(e, t => t.insertText(" big")); const s = cut(e, 6, 10); paste(e, s, at(e, "world", 5)); } },
  { name: "cut a whole line, paste at the end", doc: [p("aa"), p("bb"), p("cc")], gesture: e => { const s = cut(e, 5, 7); paste(e, s, at(e, "cc", 2)); } },
  { name: "cut someone else's insertion, paste back", doc: hello, gesture: (e, as) => { sel(e, 6); tr(e, t => t.insertText(" big")); const b = as("bob"); const s = cut(b, 6, 10); paste(b, s, 6); return b; } },
  // Paste, in the shapes PasteTransformer builds
  { name: "paste into empty paragraph", doc: [p("one"), p(""), p("two")], gesture: e => { sel(e, 6); pasteIntoEmpty(e, ["FOO"]); } },
  { name: "paste into empty last paragraph", doc: [p("one"), p("")], gesture: e => { sel(e, 6); pasteIntoEmpty(e, ["FOO"]); } },
  { name: "paste into empty list item", doc: [ul("one", "")], gesture: e => { sel(e, 10); pasteIntoEmpty(e, ["FOO"]); } },
  { name: "paste into empty table cell", doc: [table("a", ""), p("")], gesture: e => { sel(e, at(e, "a") + 5); pasteIntoEmpty(e, ["FOO"]); } },
  { name: "two paragraphs into empty paragraph", doc: [p("one"), p(""), p("two")], gesture: e => { sel(e, 6); pasteIntoEmpty(e, ["FOO", "BAR"]); } },
  { name: "plain two lines mid-line", doc: hello, gesture: e => { sel(e, 3); pasteOpen(e, ["FOO", "BAR"]); } },
  { name: "three lines mid-line", doc: hello, gesture: e => { sel(e, 3); pasteOpen(e, ["FOO", "MID", "BAR"]); } },
  { name: "two lines over a selection", doc: hello, gesture: e => { sel(e, 3, 8); pasteOpen(e, ["FOO", "BAR"]); } },
  { name: "one line mid-line", doc: hello, gesture: e => { sel(e, 3); pasteOpen(e, ["FOO"]); } },
];

const isTracking = (name: string) => name.startsWith("tracked");
const recordsOf = (node: PMNode) => getBlockInlineTrackedData(node) ?? [];

type Bare = { text: string; marks: string[] } | { t: string; a?: Record<string, unknown>; c: Bare[] };

/** The document with everything tracking adds taken away: structure, attrs, text, formatting. */
function bare(node: PMNode): Bare {
  if (node.isText) {
    const marks = node.marks
      .filter(mark => !isTracking(mark.type.name))
      .map(mark => {
        const { dataTracked: _, ...attrs } = mark.attrs;
        return Object.keys(attrs).length ? `${mark.type.name}${JSON.stringify(attrs)}` : mark.type.name;
      })
      .sort();
    return { text: node.text!, marks };
  }
  const { dataTracked: _, nodeId: __, ...rest } = node.attrs;
  const attrs = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== null && value !== undefined));
  const content: Bare[] = [];
  node.forEach(child => {
    const next = bare(child);
    const last = content[content.length - 1];
    if ("text" in next && last && "text" in last && JSON.stringify(last.marks) === JSON.stringify(next.marks)) {
      last.text += next.text;
    } else {
      content.push(next);
    }
  });
  return { t: node.type.name, ...(Object.keys(attrs).length ? { a: attrs } : {}), c: content };
}
const contentOf = (e: Editor) => JSON.stringify(bare(e.getState().doc));

/** A reader's view, for failure messages: [+inserted] [-deleted] {bold}, block records in <>. */
function show(e: Editor) {
  const blocks: string[] = [];
  e.getState().doc.descendants(node => {
    const records = recordsOf(node);
    const recorded = records.length ? `<${records.map(record => record.operation).join(",")}>` : "";
    if (!node.isTextblock) {
      if (recorded || node.isLeaf || node.type.name !== "doc") blocks.push(`${node.type.name}${recorded}`);
      return true;
    }
    let text = "";
    node.forEach(child => {
      const names = child.marks.map(mark => mark.type.name);
      let piece = child.isText ? child.text! : `(${child.type.name}${recordsOf(child).length ? "*" : ""})`;
      if (names.includes("bold")) piece = `{${piece}}`;
      if (names.includes("trackedInsert")) piece = `[+${piece}]`;
      if (names.includes("trackedDelete")) piece = `[-${piece}]`;
      text += piece;
    });
    blocks.push(`${node.type.name === "paragraph" ? "p" : node.type.name}${recorded}:${text}`);
    return false;
  });
  return blocks.join(" | ");
}

/** What a reader sees before the caret. Content proposed for deletion is struck, not there. */
function beforeCaret(e: Editor) {
  const { doc, selection } = e.getState();
  const head = selection.head;
  const struck = (node: PMNode) =>
    node.marks.some(mark => mark.type.name === "trackedDelete") ||
    recordsOf(node).some(record => record.operation === "delete" && record.status === "pending");
  // A block whose break is pending deletion runs on into the next.
  let joinsNext = false;
  let out = "";
  doc.nodesBetween(0, head, (node, pos) => {
    if (struck(node) && !node.isText) {
      // Only the struck line the caret is in shows as a line.
      if (node.isTextblock && !joinsNext && pos + node.nodeSize > head) out += "¶";
      return false;
    }
    if (node.isBlock && !node.isTextblock) return true;
    if (node.isTextblock) {
      if (!joinsNext) out += "¶";
      joinsNext = recordsOf(node).some(record => record.operation === "node_join" && record.status === "pending");
    }
    if (node.isText && !struck(node)) out += node.text!.slice(0, Math.max(0, head - pos));
    if (node.isInline && !node.isText) out += "•";
    return true;
  });
  return out;
}

const selectionKind = (e: Editor) => {
  const { selection } = e.getState();
  return selection instanceof NodeSelection ? "node" : selection.empty ? "caret" : "range";
};

function run(s: Scenario, tracked: boolean) {
  let e = make(s.doc, "alice", tracked);
  const as = (user: string) => {
    e = make(e.getState().doc.toJSON().content, user, tracked);
    return e;
  };
  return s.gesture(e, as) ?? e;
}

/** Decides one card, then any dependents it names, until the combined decision applies. */
function decideCard(e: Editor, ids: string[], decision: keyof ReviewDecisions): string | null {
  let outcome: ReviewOutcome = decide(e, decision === "accepted" ? { accepted: ids, rejected: [] } : { accepted: [], rejected: ids });
  for (let round = 0; round < 6 && outcome.status !== "applied"; round++) {
    if (outcome.status !== "blocked" || outcome.reason !== "dependent-changes") return `${decision}: ${outcome.status}`;
    const combined: ReviewDecisions = { accepted: [...outcome.accepted], rejected: [...outcome.rejected] };
    for (const { changeId, dependentIds } of outcome.dependencies) {
      const side = combined.accepted.includes(changeId) ? combined.accepted : combined.rejected;
      for (const id of dependentIds) if (!side.includes(id)) side.push(id);
    }
    outcome = decide(e, combined);
  }
  return outcome.status === "applied" ? null : `${decision}: dependents never settled`;
}

/** Everything the tracked run got wrong; empty when it behaves. */
function judge(s: Scenario): string[] {
  const failures: string[] = [];
  const original = contentOf(make(s.doc, "alice", false));
  const untrackedRun = run(s, false);
  const wanted = contentOf(untrackedRun);
  const fresh = () => run(s, true);

  const tracked = fresh();
  const tracking = trackChangesPluginKey.getState(tracked.getState())?.lastTracking;
  if (tracking?.status === "refused") failures.push(`refused: ${tracking.reason}`);
  if (beforeCaret(tracked) !== beforeCaret(untrackedRun)) {
    failures.push(`caret after "${beforeCaret(tracked)}", not "${beforeCaret(untrackedRun)}"`);
  }
  if (selectionKind(tracked) !== selectionKind(untrackedRun)) {
    failures.push(`selection is a ${selectionKind(tracked)}, not a ${selectionKind(untrackedRun)}`);
  }
  if (contentOf(tracked) !== wanted && !pendingOf(tracked).length) failures.push("changed the document with no record");

  const bulk: Array<[keyof ReviewDecisions, string]> = [["accepted", wanted], ["rejected", original]];
  for (const [decision, result] of bulk) {
    const e = fresh();
    const outcome = decide(e, decision === "accepted"
      ? { accepted: pendingOf(e).map(c => c.id), rejected: [] }
      : { accepted: [], rejected: pendingOf(e).map(c => c.id) });
    if (outcome.status !== "applied") failures.push(`all ${decision}: ${outcome.status}`);
    if (pendingOf(e).length) failures.push(`all ${decision}: ${pendingOf(e).length} left`);
    if (contentOf(e) !== result) failures.push(`all ${decision}: ${show(e)}`);
  }

  const cards = changeActs(pendingOf(tracked)).length;
  const decisions: Array<keyof ReviewDecisions> = ["accepted", "rejected"];
  const orders: Array<"first" | "last"> = ["first", "last"];
  for (const decision of decisions) {
    for (let card = 0; card < cards; card++) {
      const e = fresh();
      const act = changeActs(pendingOf(e))[card]!;
      const problem = decideCard(e, [act.primary.id], decision);
      if (problem) failures.push(`card ${card} ${problem}`);
    }
    for (const order of orders) {
      const e = fresh();
      for (let round = 0; round < 40 && pendingOf(e).length; round++) {
        const all = changeActs(pendingOf(e));
        const act = order === "first" ? all[0]! : all[all.length - 1]!;
        const problem = decideCard(e, [act.primary.id], decision);
        if (problem) {
          failures.push(`one by one from the ${order}: ${problem}`);
          break;
        }
      }
      if (contentOf(e) !== (decision === "accepted" ? wanted : original)) {
        failures.push(`one by one ${decision} from the ${order}: ${show(e)}`);
      }
    }
  }

  const problem = s.check?.(fresh());
  if (problem) failures.push(problem);
  return failures;
}

describe("every tracked gesture can be decided", () => {
  it.each(scenarios)("$name", scenario => {
    // The engine logs what a refusal or a blocked review saw; the failures say it better.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(judge(scenario), show(run(scenario, true))).toEqual([]);
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });
});
