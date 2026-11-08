/**
 * The acceptance property for reviewing tracked changes:
 *
 *   every review click either completes the decision, or visibly explains what
 *   prevented it — and no click silently decides work the reviewer did not ask
 *   for.
 *
 * Driven against a real ServerEditor and real track-changes: the per-change
 * cases through the shared action a card uses, and the document-wide ones
 * through the shipped panel itself, so what is asserted is what a reviewer sees.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TrackChanges, TrackChangesStatus, trackChangesPluginKey } from "@scrivr/plugins";
import type { TrackedChange } from "@scrivr/plugins";
// Through the package entry, as a consumer imports them.
import { ReviewRefusalNotice, TrackChangesPanel, useReviewAction, useTrackChangesPanel } from "../index";
import type { ReviewAction, ReviewRefusalNoticeProps, ReviewRefusalState, TrackChangesDisplayItem } from "../index";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const build = (canAcceptReject = true) => {
  const editor = new ServerEditor({
    extensions: [
      StarterKit,
      TrackChanges.configure({
        userID: "alice",
        initialStatus: TrackChangesStatus.enabled,
        canAcceptReject,
      }),
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { nodeId: "a" }, content: [{ type: "text", text: "tail" }] },
      ],
    },
  });
  const node = editor.schema.node("paragraph", { nodeId: "new" }, editor.schema.text("new"));
  editor.applyTransaction(editor.getState().tr.insert(0, node));
  return editor;
};

const pending = (editor: ServerEditor): TrackedChange[] =>
  trackChangesPluginKey.getState(editor.getState())!.changeSet.pending;

const creationId = (editor: ServerEditor) =>
  pending(editor).find(c => c.type === "node-change" && c.dataTracked.operation === "insert")!.id;

/** A card that rejects `ids` on click and shows whatever stopped it. */
function Card({ editor, ids }: { editor: ServerEditor; ids: string[] }) {
  const review: ReviewAction = useReviewAction(editor);
  const held: ReviewRefusalState | null = review.refusal;
  const notice: ReviewRefusalNoticeProps = { action: review };
  return (
    <div data-held={held?.stage}>
      <button type="button" onClick={() => review.decide("rejected", ids)}>
        Reject
      </button>
      <ReviewRefusalNotice {...notice} />
    </div>
  );
}

const render = (ui: React.ReactElement) => act(() => root.render(ui));
const click = (label: string | RegExp) => {
  const match = [...container.querySelectorAll("button")].find(b =>
    typeof label === "string" ? b.textContent === label : label.test(b.textContent ?? ""),
  );
  if (!match) throw new Error(`no button matching ${label}; saw: ${text()}`);
  act(() => match.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const text = () => container.textContent ?? "";

describe("every review click resolves or explains", () => {
  it("completes a decision that has nothing depending on it", () => {
    const editor = build();
    render(<Card editor={editor} ids={pending(editor).map(c => c.id)} />);

    click("Reject");

    expect(pending(editor)).toEqual([]);
    expect(text()).not.toMatch(/pending changes/i);
  });

  it("explains a refusal on the card instead of doing nothing", () => {
    const editor = build();
    const creation = creationId(editor);
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));
    const before = editor.getState().doc;
    render(<Card editor={editor} ids={[creation]} />);

    click("Reject");

    expect(text()).toMatch(/contains bob's pending changes/i);
    expect(editor.getState().doc).toBe(before);
  });

  it("shows the dependent work without deciding it", () => {
    const editor = build();
    const creation = creationId(editor);
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));
    const before = editor.getState().doc;
    render(<Card editor={editor} ids={[creation]} />);

    click("Reject");
    click("Review dependent changes");

    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(editor.getState().doc).toBe(before);
  });

  it("needs a second, explicit confirmation before deciding dependent work", () => {
    const editor = build();
    const creation = creationId(editor);
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));
    const before = editor.getState().doc;
    render(<Card editor={editor} ids={[creation]} />);

    click("Reject");
    click(/^Reject this and/);
    // The confirmation lists what it covers, and still has not decided anything.
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(editor.getState().doc).toBe(before);

    click(/^Reject all/);

    expect(pending(editor)).toEqual([]);
    expect(editor.getState().doc).not.toBe(before);
  });

  it("counts every change the compound decision will take", () => {
    const editor = build();
    const creation = creationId(editor);
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));
    const all = pending(editor).length;
    render(<Card editor={editor} ids={[creation]} />);

    click("Reject");
    click(/^Reject this and/);

    expect(text()).toContain(`Reject all ${all}`);
  });

  it("keeps its buttons across a re-render, so focus stays put", () => {
    const editor = build();
    function Parent() {
      const [, setTick] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => setTick(t => t + 1)}>Rerender</button>
          <Card editor={editor} ids={["no-such-change"]} />
        </div>
      );
    }
    render(<Parent />);
    click("Reject");
    const dismiss = [...container.querySelectorAll("button")].find(b => b.textContent === "Dismiss");

    click("Rerender");

    expect([...container.querySelectorAll("button")].find(b => b.textContent === "Dismiss")).toBe(dismiss);
  });

  it("cancels without deciding anything", () => {
    const editor = build();
    const creation = creationId(editor);
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));
    const count = pending(editor).length;
    render(<Card editor={editor} ids={[creation]} />);

    click("Reject");
    click("Cancel");

    expect(text()).not.toMatch(/pending changes/i);
    expect(pending(editor)).toHaveLength(count);
  });

  it("does not offer a compound decision for a change that is not pending", () => {
    const editor = build();
    render(<Card editor={editor} ids={["no-such-change"]} />);

    click("Reject");

    expect(text()).toMatch(/no longer pending/i);
    expect(text()).not.toMatch(/dependent change/i);
  });
});

/** A conflict card: keeping one side discards the other, as one decision. */
function ConflictCard({ editor, keep, discard }: { editor: ServerEditor; keep: string; discard: string[] }) {
  const review = useReviewAction(editor);
  return (
    <div>
      <button type="button" onClick={() => review.resolveConflict(keep, discard)}>
        Keep
      </button>
      <ReviewRefusalNotice action={review} />
    </div>
  );
}

describe("resolving a conflict", () => {
  it("keeps one author's change and discards the other's in one decision", () => {
    const editor = build();
    const creation = creationId(editor);
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.delete(0, 5));
    const deletion = pending(editor).find(c => c.type === "node-change" && c.dataTracked.authorID === "bob")!.id;
    render(<ConflictCard editor={editor} keep={deletion} discard={[creation]} />);

    click("Keep");

    expect(pending(editor)).toEqual([]);
    expect(editor.getState().doc.textContent).toBe("tail");
    expect(text()).not.toMatch(/pending changes|could not/i);
  });
});

describe("the shipped panel explains its document-wide decisions", () => {
  it("says why Accept all did nothing, beside the button that did nothing", () => {
    const editor = build(false);
    render(<TrackChangesPanel editor={editor} />);

    click("Accept all");

    expect(text()).toMatch(/do not have permission/i);
    expect(pending(editor).length).toBeGreaterThan(0);
  });

  it("shows a deletion split by another author's typing as one change", () => {
    const editor = build();
    editor.applyTransaction(editor.getState().tr.delete(6, 10));
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 8));
    render(<TrackChangesPanel editor={editor} />);

    expect(text().match(/Removing/g)).toHaveLength(1);
    expect(text()).toContain("ta … il");
  });

  it("does not decide anything in a read-only editor, and says why", () => {
    const editor = build();
    editor.setReadOnly(true);
    const before = editor.getState().doc;
    render(<TrackChangesPanel editor={editor} />);

    click("Reject all");

    expect(editor.getState().doc).toBe(before);
    expect(text()).toMatch(/read-only/i);
  });

  it("explains a blocked Reject all rather than leaving a dead button", () => {
    const editor = build();
    editor.commands.setTrackChangesUserID("bob");
    editor.applyTransaction(editor.getState().tr.insertText("!", 4));
    render(<TrackChangesPanel editor={editor} />);

    const before = editor.getState().doc;
    click("Reject all");

    // Either it resolved everything, or it said what stopped it. Never silence.
    if (editor.getState().doc === before) {
      expect(text()).toMatch(/pending changes|no longer pending|could not be completed/i);
    } else {
      expect(pending(editor)).toEqual([]);
    }
  });
});

describe("one card per act", () => {
  const cards = () => [...container.querySelectorAll("button")].filter(b => b.textContent === "✗").length;

  it("shows an inserted paragraph, recorded on the node and its text, once", () => {
    const editor = build();
    expect(pending(editor).length).toBeGreaterThan(1);

    render(<TrackChangesPanel editor={editor} />);

    expect(cards()).toBe(1);
    expect(container.querySelector('[data-part="icon"]')?.textContent).toBe("1");
  });

  it("names the act's records on the item a headless host renders", () => {
    function Items({ editor }: { editor: ServerEditor }) {
      const { items } = useTrackChangesPanel(editor);
      const item: TrackChangesDisplayItem | undefined = items[0];
      return <span data-testid="pieces">{item?.kind === "single" ? item.pieces.length : 0}</span>;
    }
    const editor = build();
    render(<Items editor={editor} />);

    expect(container.querySelector("[data-testid=pieces]")?.textContent).toBe(String(pending(editor).length));
  });

  it("removes the whole paragraph from that one card", () => {
    const editor = build();
    render(<TrackChangesPanel editor={editor} />);

    click("✗");

    expect(pending(editor)).toEqual([]);
    expect(editor.getState().doc.textContent).toBe("tail");
  });
});

describe("work that grows while it is being confirmed", () => {
  it("still lists what the reviewer already saw beside what is new", () => {
    const editor = build();
    const id = creationId(editor);
    const editAs = (author: string, pos: number) => {
      editor.commands.setTrackChangesUserID(author);
      editor.applyTransaction(editor.getState().tr.insertText("x", pos));
    };
    editAs("bob", 4);
    render(<Card editor={editor} ids={[id]} />);
    click("Reject");
    click(/^Reject this and/);
    act(() => editAs("carol", 2));

    click(/^Reject all/);

    expect(text()).toMatch(/More work now depends/);
    expect(text()).toMatch(/bob/);
    expect(text()).toMatch(/carol/);
  });
});

describe("review before there is an editor to review against", () => {
  function Early() {
    const review = useReviewAction(null);
    const [status, setStatus] = useState("untried");
    return (
      <div>
        <button type="button" onClick={() => setStatus(review.decide("accepted", ["x"]).status)}>
          Accept
        </button>
        <span data-testid="status">{status}</span>
        <span data-testid="available">{String(review.available)}</span>
        <ReviewRefusalNotice action={review} />
      </div>
    );
  }

  it("reports unavailable rather than nothing, and shows no refusal", () => {
    render(<Early />);
    expect(container.querySelector("[data-testid=available]")?.textContent).toBe("false");

    click("Accept");

    expect(container.querySelector("[data-testid=status]")?.textContent).toBe("unavailable");
    // Lifecycle is not a refusal: there is nothing to explain to a reviewer.
    expect(text()).not.toMatch(/permission|no longer pending|could not be completed/i);
  });

  it("hides the document-wide controls while unavailable", () => {
    render(<TrackChangesPanel editor={null} />);

    expect([...container.querySelectorAll("button")].map(b => b.textContent))
      .not.toContain("Accept all");
  });
});
