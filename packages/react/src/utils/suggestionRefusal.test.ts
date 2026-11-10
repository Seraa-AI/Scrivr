import { describe, expect, it } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { Fragment, ReplaceStep, Slice, Step, StepMap, StepResult, type Node } from "@scrivr/core/pm";
import { TrackChanges, TrackChangesStatus } from "@scrivr/plugins";
import type { TrackingRefusal } from "@scrivr/plugins";
// Through the package entry, as a consumer imports it.
import { describeSuggestionRefusal } from "../index";

/** A step kind track changes has no way to record. */
class ShoutStep extends Step {
  constructor(private readonly from: number, private readonly to: number) {
    super();
  }
  override apply(doc: Node) {
    const text = doc.type.schema.text(doc.textBetween(this.from, this.to).toUpperCase());
    return StepResult.fromReplace(doc, this.from, this.to, new Slice(Fragment.from(text), 0, 0));
  }
  override getMap() {
    return StepMap.empty;
  }
  override invert(doc: Node) {
    return new ReplaceStep(this.from, this.to, doc.slice(this.from, this.to));
  }
  override map() {
    return this;
  }
  override toJSON() {
    return { stepType: "shout", from: this.from, to: this.to };
  }
}

describe("an edit stopped while suggesting", () => {
  it("leaves the text alone and gives the host words for why, and what to do", () => {
    const refused: TrackingRefusal[] = [];
    const editor = new ServerEditor({
      extensions: [StarterKit, TrackChanges.configure({
        userID: "alice", initialStatus: TrackChangesStatus.enabled, onRefused: refusal => refused.push(refusal),
      })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "quiet" }] }] },
    });
    editor.applyTransaction(editor.getState().tr.step(new ShoutStep(1, 6)));

    expect(editor.getState().doc.textContent).toBe("quiet");
    expect(refused).toHaveLength(1);
    const text = describeSuggestionRefusal(refused[0]!);
    expect(text.message).toMatch(/can't be suggested/);
    expect(text.remedy.length).toBeGreaterThan(0);
  });
});
