/**
 * AiSuggestionPlugin state machine tests.
 *
 * Exercises every meta action key against a bare EditorState so the
 * plugin's apply() reducer is verified in isolation.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import {
  aiSuggestionPlugin,
  aiSuggestionPluginKey,
  AI_SUGGESTION_SET,
  AI_SUGGESTION_SET_STALE,
  AI_SUGGESTION_SET_HOVER,
  AI_SUGGESTION_SET_ACTIVE,
} from "../AiSuggestionPlugin";
import { doc, p } from "./helpers";
import type { AiSuggestion } from "../types";


function makeState() {
  return EditorState.create({
    doc: doc(p("hello")),
    plugins: [aiSuggestionPlugin],
  });
}

const SUGGESTION: AiSuggestion = {
  blocks: [
    {
      nodeId: "node-1",
      acceptedText: "hello",
      ops: [
        { type: "delete", text: "hello", groupId: "g1" },
        { type: "insert", text: "world", groupId: "g1" },
      ],
    },
  ],
};

describe("AiSuggestionPlugin — initial state", () => {
  it("starts with null suggestion and empty sets", () => {
    const ps = aiSuggestionPluginKey.getState(makeState())!;
    expect(ps.suggestion).toBeNull();
    expect(ps.staleBlockIds.size).toBe(0);
    expect(ps.hoverBlockId).toBeNull();
    expect(ps.activeBlockId).toBeNull();
  });
});

describe("AiSuggestionPlugin — AI_SUGGESTION_SET", () => {
  it("stores the suggestion payload", () => {
    const state = makeState();
    const next = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET, { payload: SUGGESTION }),
    );
    const ps = aiSuggestionPluginKey.getState(next)!;
    expect(ps.suggestion).toBe(SUGGESTION);
  });

  it("resets staleBlockIds, hoverBlockId, activeBlockId when suggestion changes", () => {
    let state = makeState();
    // First set hover and active
    state = state.apply(state.tr.setMeta(AI_SUGGESTION_SET_HOVER, "node-1"));
    state = state.apply(state.tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "node-1"));
    state = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET_STALE, new Set(["node-1"])),
    );

    // Now set a new suggestion — all side fields should reset
    state = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET, { payload: SUGGESTION }),
    );
    const ps = aiSuggestionPluginKey.getState(state)!;
    expect(ps.staleBlockIds.size).toBe(0);
    expect(ps.hoverBlockId).toBeNull();
    expect(ps.activeBlockId).toBeNull();
  });

  it("clears suggestion when payload is null", () => {
    let state = makeState();
    state = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET, { payload: SUGGESTION }),
    );
    state = state.apply(state.tr.setMeta(AI_SUGGESTION_SET, { payload: null }));
    const ps = aiSuggestionPluginKey.getState(state)!;
    expect(ps.suggestion).toBeNull();
  });
});

describe("AiSuggestionPlugin — AI_SUGGESTION_SET_STALE", () => {
  it("updates staleBlockIds", () => {
    const state = makeState();
    const stale = new Set(["node-1", "node-2"]);
    const next = state.apply(state.tr.setMeta(AI_SUGGESTION_SET_STALE, stale));
    const ps = aiSuggestionPluginKey.getState(next)!;
    expect(ps.staleBlockIds).toBe(stale);
  });

  it("preserves other fields", () => {
    let state = makeState();
    state = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET, { payload: SUGGESTION }),
    );
    state = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET_STALE, new Set(["node-1"])),
    );
    const ps = aiSuggestionPluginKey.getState(state)!;
    expect(ps.suggestion).toBe(SUGGESTION);
  });
});

describe("AiSuggestionPlugin — AI_SUGGESTION_SET_HOVER", () => {
  it("stores hovered block id", () => {
    const state = makeState();
    const next = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET_HOVER, "node-1"),
    );
    expect(aiSuggestionPluginKey.getState(next)!.hoverBlockId).toBe("node-1");
  });

  it("clears hover when null is dispatched", () => {
    let state = makeState();
    state = state.apply(state.tr.setMeta(AI_SUGGESTION_SET_HOVER, "node-1"));
    state = state.apply(state.tr.setMeta(AI_SUGGESTION_SET_HOVER, null));
    expect(aiSuggestionPluginKey.getState(state)!.hoverBlockId).toBeNull();
  });
});

describe("AiSuggestionPlugin — AI_SUGGESTION_SET_ACTIVE", () => {
  it("stores active block id", () => {
    const state = makeState();
    const next = state.apply(
      state.tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "node-1"),
    );
    expect(aiSuggestionPluginKey.getState(next)!.activeBlockId).toBe("node-1");
  });

  it("clears active when null is dispatched", () => {
    let state = makeState();
    state = state.apply(state.tr.setMeta(AI_SUGGESTION_SET_ACTIVE, "node-1"));
    state = state.apply(state.tr.setMeta(AI_SUGGESTION_SET_ACTIVE, null));
    expect(aiSuggestionPluginKey.getState(state)!.activeBlockId).toBeNull();
  });
});

describe("AiSuggestionPlugin — object identity", () => {
  it("returns the same object reference for unrelated transactions", () => {
    const state = makeState();
    const prev = aiSuggestionPluginKey.getState(state);
    // A plain text insert has no AI meta — plugin state should be same ref
    const next = state.apply(state.tr.insertText("!"));
    const after = aiSuggestionPluginKey.getState(next);
    expect(after).toBe(prev);
  });
});
