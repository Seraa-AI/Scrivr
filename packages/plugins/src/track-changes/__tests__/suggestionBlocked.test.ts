import { describe, expect, it } from "vitest";
import { EditorState, Fragment, ReplaceStep, Slice, Step, StepMap, StepResult } from "@scrivr/core/pm";
import type { Node as PMNode } from "@scrivr/core/pm";
import { doc, p } from "./helpers";
import { suggestionBlocked, trackAsSuggestion, TrackChangesStatus } from "../index";
import { trackChangesPlugin } from "../engine/trackChangesPlugin";

/**
 * A lane writes a suggestion only when it will be recorded as one. Asked before
 * dispatching, `suggestionBlocked` says why it would not be: no tracking to
 * record it, snapshots being viewed, or a gesture tracking refuses.
 */

/** A content step the engine has no tracker for, so tracking refuses it. */
class UpperStep extends Step {
  constructor(private readonly from: number, private readonly to: number) {
    super();
  }
  override apply(target: PMNode) {
    const upper = target.type.schema.text(target.textBetween(this.from, this.to).toUpperCase());
    return StepResult.fromReplace(target, this.from, this.to, new Slice(Fragment.from(upper), 0, 0));
  }
  override getMap() {
    return StepMap.empty;
  }
  override invert(doc: PMNode) {
    return new ReplaceStep(this.from, this.to, doc.slice(this.from, this.to));
  }
  override map() {
    return this;
  }
  override toJSON() {
    return { stepType: "upper", from: this.from, to: this.to };
  }
}

const stateWith =(status: TrackChangesStatus | null) =>
  EditorState.create({
    doc: doc(p("start")),
    plugins: status === null ? [] : [trackChangesPlugin({ userID: "alice", initialStatus: status })],
  });

const suggestion = (state: EditorState) => trackAsSuggestion(state.tr.insertText("x", 1), "ai");

describe("suggestionBlocked", () => {
  it("lets a suggestion through while suggesting", () => {
    const state = stateWith(TrackChangesStatus.enabled);
    expect(suggestionBlocked(state, suggestion(state))).toBeNull();
  });

  it("lets a suggestion through while tracking is off, which records it anyway", () => {
    const state = stateWith(TrackChangesStatus.disabled);
    expect(suggestionBlocked(state, suggestion(state))).toBeNull();
  });

  it("blocks a suggestion with no tracking to record it", () => {
    const state = stateWith(null);
    expect(suggestionBlocked(state, suggestion(state))).toEqual({ reason: "no-tracking" });
  });

  it("blocks a suggestion while snapshots are viewed", () => {
    const state = stateWith(TrackChangesStatus.viewSnapshots);
    expect(suggestionBlocked(state, suggestion(state))).toEqual({ reason: "viewing-snapshots" });
  });

  it("blocks a gesture tracking refuses, with its reason", () => {
    const state = stateWith(TrackChangesStatus.enabled);
    const tr = trackAsSuggestion(state.tr.step(new UpperStep(1, 6)), "ai");
    expect(suggestionBlocked(state, tr)).toEqual({ reason: "unsupported-step", stepType: "UpperStep" });
  });
});
