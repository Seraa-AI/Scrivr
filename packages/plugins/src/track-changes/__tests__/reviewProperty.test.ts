import { describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import type { Node as PmNode, Transaction } from "@scrivr/core/pm";
import { changeActs, findChanges, reviewChanges, TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "../index";

/**
 * The promise review makes, against many documents no one wrote by hand: a
 * document with pending work can always be decided. Accept all and Reject all
 * finish; every card either applies or names dependent work whose compound
 * decision then applies; rejecting everything gives back the original, and
 * accepting everything gives what the reader was already shown.
 */

const SEEDS = Number(process.env.REVIEW_PROPERTY_SEEDS ?? 150);

const seeded = (start: number) => {
  let seed = start;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const paragraph = (nodeId: string, text: string) => ({ type: "paragraph", attrs: { nodeId }, content: [{ type: "text", text }] });

const START = [
  paragraph("a", "alpha beta"),
  paragraph("b", "gamma delta"),
  {
    type: "bulletList",
    attrs: { nodeId: "l" },
    content: [
      { type: "listItem", attrs: { nodeId: "i1" }, content: [paragraph("c", "first item")] },
      { type: "listItem", attrs: { nodeId: "i2" }, content: [paragraph("d", "second item")] },
    ],
  },
  { type: "codeBlock", attrs: { nodeId: "e" }, content: [{ type: "text", text: "const x" }] },
  paragraph("f", "epsilon zeta"),
];

const editorFor = (userID: string, content: unknown) =>
  new ServerEditor({
    extensions: [StarterKit, TrackChanges.configure({ userID, initialStatus: TrackChangesStatus.enabled, canAcceptReject: true })],
    content: { type: "doc", content },
  });

const isStruck = (node: PmNode) => node.marks.some(mark => mark.type.name === "trackedDelete");
const blockDeleted = (node: PmNode) => {
  const records: unknown = node.attrs.dataTracked;
  return Array.isArray(records) && records.some(record => record?.operation === "delete");
};

/** Non-empty block text. `shown` leaves out what is proposed for deletion, as a reader sees it. */
function blockTexts(doc: PmNode, shown: boolean) {
  const out: string[] = [];
  const walk = (node: PmNode) => {
    if (shown && blockDeleted(node)) return;
    if (!node.isTextblock) return node.forEach(walk);
    let text = "";
    node.forEach(child => {
      if (child.isText && !(shown && isStruck(child))) text += child.text;
    });
    if (text) out.push(text);
  };
  doc.forEach(walk);
  return out;
}

const pending = (editor: ServerEditor) => findChanges(editor.getState()).pending;

const textblockRanges = (doc: PmNode) => {
  const out: Array<{ from: number; to: number; marksAllowed: boolean }> = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && node.content.size > 0) {
      out.push({ from: pos + 1, to: pos + 1 + node.content.size, marksAllowed: node.type.name !== "codeBlock" });
    }
    return !node.isTextblock;
  });
  return out;
};

/** A plausible gesture, or null when this document offers no place for it. */
function gesture(editor: ServerEditor, random: () => number): Transaction | null {
  const state = editor.getState();
  const ranges = textblockRanges(state.doc);
  const range = ranges[Math.floor(random() * ranges.length)];
  if (!range) return null;
  const at = range.from + Math.floor(random() * (range.to - range.from + 1));
  const kind = random();
  const newParagraph = (text: string) => state.schema.nodes.paragraph!.create({ nodeId: `p${at}` }, state.schema.text(text));

  if (kind < 0.25) return state.tr.insertText("XY", at);
  if (kind < 0.45) {
    const to = Math.min(range.to, at + 1 + Math.floor(random() * 4));
    return to > at ? state.tr.delete(at, to) : null;
  }
  if (kind < 0.55) return at > range.from && at < range.to ? state.tr.split(at).setMeta("uiEvent", "Enter") : null;
  if (kind < 0.7) {
    const to = Math.min(range.to, at + 3);
    return to > at && range.marksAllowed ? state.tr.addMark(at, to, state.schema.marks.bold!.create()) : null;
  }
  if (kind < 0.8) return state.tr.insert(state.doc.content.size, newParagraph("new"));
  if (kind < 0.9) {
    // Insert a block and go on to edit inside it, all in one gesture.
    const end = state.doc.content.size;
    return state.tr.insert(end, newParagraph("draft")).insertText("Q", end + 3);
  }
  // Move a top-level block to the top of the document.
  const index = 1 + Math.floor(random() * (state.doc.childCount - 1));
  if (index >= state.doc.childCount) return null;
  let from = 0;
  for (let i = 0; i < index; i++) from += state.doc.child(i).nodeSize;
  const node = state.doc.child(index);
  // A block already proposed for deletion is not something a person can pick up.
  if (node.type.name !== "paragraph" || blockDeleted(node)) return null;
  const tr = state.tr.delete(from, from + node.nodeSize);
  return tr.insert(0, node);
}

/** Replays one seed, so each decision can be tried from the same starting point. */
function scenario(seed: number) {
  const random = seeded(seed);
  let editor = editorFor("alice", START);
  const steps = 2 + Math.floor(random() * 5);
  let refused = false;
  for (let i = 0; i < steps; i++) {
    if (random() < 0.3) editor = editorFor(random() < 0.5 ? "alice" : "bob", editor.getState().doc.toJSON().content);
    const tr = gesture(editor, random);
    if (!tr) continue;
    editor.applyTransaction(tr);
    if (trackChangesPluginKey.getState(editor.getState())?.lastTracking?.status === "refused") refused = true;
  }
  return { editor, refused };
}

const ORIGINAL = blockTexts(editorFor("alice", START).getState().doc, false);

describe("any pending document can be decided", () => {
  // These must not reach a reviewer as failures; the engine logs when they do.
  const silenced = () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return () => { error.mockRestore(); warn.mockRestore(); };
  };

  it("rejecting everything finishes and restores the original", () => {
    const restore = silenced();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { editor, refused } = scenario(seed);
      const ids = pending(editor).map(c => c.id);
      const outcome = reviewChanges(editor, { accepted: [], rejected: ids });
      expect(outcome.status, `seed ${seed}`).toBe("applied");
      expect(pending(editor), `seed ${seed}`).toEqual([]);
      if (!refused) expect(blockTexts(editor.getState().doc, false), `seed ${seed}`).toEqual(ORIGINAL);
    }
    restore();
  });

  it("accepting everything finishes and leaves what the reader was shown", () => {
    const restore = silenced();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { editor } = scenario(seed);
      const shown = blockTexts(editor.getState().doc, true);
      const ids = pending(editor).map(c => c.id);
      const outcome = reviewChanges(editor, { accepted: ids, rejected: [] });
      expect(outcome.status, `seed ${seed}`).toBe("applied");
      expect(pending(editor), `seed ${seed}`).toEqual([]);
      expect(blockTexts(editor.getState().doc, false).join(""), `seed ${seed}`).toEqual(shown.join(""));
    }
    restore();
  });

  it.each(["accepted", "rejected"] as const)("every card can be %s", decision => {
    const restore = silenced();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const cards = changeActs(pending(scenario(seed).editor)).length;
      for (let card = 0; card < cards; card++) {
        const { editor } = scenario(seed);
        const act = changeActs(pending(editor))[card]!;
        const asked = [act.primary.id];
        const first = reviewChanges(editor, decision === "accepted" ? { accepted: asked, rejected: [] } : { accepted: [], rejected: asked });
        const label = `seed ${seed} card ${card} (${act.primary.dataTracked.operation})`;
        if (first.status === "blocked" && first.reason === "dependent-changes") {
          const compound = { accepted: [...first.accepted], rejected: [...first.rejected] };
          for (const { changeId, dependentIds } of first.dependencies) {
            compound[first.accepted.includes(changeId) ? "accepted" : "rejected"].push(...dependentIds);
          }
          const second = reviewChanges(editor, compound);
          if (second.status === "blocked") expect(second.reason, label).toBe("dependent-changes");
          else expect(second.status, label).toBe("applied");
        } else {
          expect(first.status, label).toBe("applied");
          const left = new Set(pending(editor).map(c => c.id));
          expect(act.records.filter(r => left.has(r.id)), label).toEqual([]);
        }
      }
    }
    restore();
  });
});
