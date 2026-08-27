import { describe, it, expect } from "vitest";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
// Imported through the package barrel on purpose: these are the types a host
// implements against, and `tsc` fails here the moment the barrel stops
// exporting one. The gap this test file was written for was exactly that —
// helpers reachable, the provider contract not.
import type {
  SourceProvider as PublicSourceProvider,
  SourceContent as PublicSourceContent,
  SourceSearchResult as PublicSourceSearchResult,
  SourceCapability as PublicSourceCapability,
  SourcedBlockEvent as PublicSourcedBlockEvent,
  SourcedBlockChangedEvent as PublicSourcedBlockChangedEvent,
  SourcedBlockRecord as PublicSourcedBlockRecord,
  SourcedBlockDivergenceState as PublicSourcedBlockDivergenceState,
} from "../../index";
import {
  SourcedBlockExtension,
  collectSourcedBlocks,
  computeBlockHash,
  type SourceProvider,
  type SourcedBlockChangedEvent,
} from "./SourcedBlock";

/**
 * The host's half of sourced blocks: reading provenance out of a document,
 * marking instances the library has moved past, and being told when either
 * fact changes.
 *
 * The two facts have different owners and this is where that shows. The editor
 * computes `modified` by hashing content. It cannot compute `outdated` — that
 * is a question about the library — so the host answers it and the editor
 * stores the answer on the block, where collaborators and reloads can see it.
 */

/** The host-facing surface, as a consumer sees it. */
export type PublicSurface = [
  PublicSourceProvider,
  PublicSourceContent,
  PublicSourceSearchResult,
  PublicSourceCapability,
  PublicSourcedBlockEvent,
  PublicSourcedBlockChangedEvent,
  PublicSourcedBlockRecord,
  PublicSourcedBlockDivergenceState,
];

function blockJSON(instanceId: string, text: string, attrs: Record<string, unknown> = {}) {
  return {
    type: "sourcedBlock",
    attrs: {
      instanceId,
      kind: "clause",
      resourceId: `cl_${instanceId}`,
      versionId: "v1",
      baseHash: "",
      baseNormalizer: 1,
      ...attrs,
    },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function editorWith(
  blocks: ReturnType<typeof blockJSON>[],
  provider?: SourceProvider,
): ServerEditor {
  return new ServerEditor({
    extensions: [
      StarterKit,
      SourcedBlockExtension.configure(provider ? { providers: [provider] } : {}),
    ],
    content: { type: "doc", content: blocks },
  });
}

function recordingProvider(seen: SourcedBlockChangedEvent[]): SourceProvider {
  return {
    kind: "clause",
    search: async () => [],
    fetch: async () => ({ resourceId: "", versionId: "", contentJSON: {}, label: "" }),
    registerInstance: async () => {},
    onInstanceChanged: async (event) => {
      seen.push(event);
    },
  };
}

describe("marking instances the library has moved past", () => {
  it("marks several at once, in one transaction", () => {
    const editor = editorWith([
      blockJSON("a", "alpha"),
      blockJSON("b", "beta"),
      blockJSON("c", "gamma"),
    ]);

    editor.commands.setSourcedBlocksOutdated({ instanceIds: ["a", "c"], outdated: true });

    const byId = new Map(
      collectSourcedBlocks(editor.getState().doc).map((r) => [r.instanceId, r.outdated]),
    );
    expect(byId.get("a")).toBe(true);
    expect(byId.get("b")).toBe(false);
    expect(byId.get("c")).toBe(true);
  });

  it("leaves the document alone for ids that are not in it", () => {
    const editor = editorWith([blockJSON("a", "alpha")]);
    const before = editor.getState().doc;
    editor.commands.setSourcedBlocksOutdated({ instanceIds: ["nope"], outdated: true });
    expect(editor.getState().doc.eq(before)).toBe(true);
  });

  it("writes nothing when the flags already say so, so a repeat check is free", () => {
    const editor = editorWith([blockJSON("a", "alpha", { outdated: true })]);
    const before = editor.getState().doc;
    editor.commands.setSourcedBlocksOutdated({ instanceIds: ["a"], outdated: true });
    expect(editor.getState().doc.eq(before)).toBe(true);
  });

  it("clears the flag after the instance is brought up to date", () => {
    const editor = editorWith([blockJSON("a", "alpha", { outdated: true })]);
    editor.commands.setSourcedBlocksOutdated({ instanceIds: ["a"], outdated: false });
    expect(collectSourcedBlocks(editor.getState().doc)[0]?.outdated).toBe(false);
  });
});

describe("telling the provider when a block's relationship to its source changes", () => {
  it("reports a block the host has just marked outdated", () => {
    const seen: SourcedBlockChangedEvent[] = [];
    const editor = editorWith([blockJSON("a", "alpha")], recordingProvider(seen));

    editor.commands.setSourcedBlocksOutdated({ instanceIds: ["a"], outdated: true });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      instanceId: "a",
      resourceId: "cl_a",
      kind: "clause",
      outdated: true,
    });
  });

  it("reports a block the reader has just edited away from its source", () => {
    const seen: SourcedBlockChangedEvent[] = [];
    // baseHash matches the content as loaded, so the block starts clean.
    const editor = editorWith([blockJSON("a", "alpha")], recordingProvider(seen));
    const pos = 0;
    const node = editor.getState().doc.nodeAt(pos);
    if (!node) throw new Error("no sourced block at 0");
    // Record the block's own hash as its base, so it starts clean.
    editor.setNodeAttrs(pos, { baseHash: computeBlockHash(node.content) });
    seen.length = 0;

    const state = editor.getState();
    editor.applyTransaction(state.tr.insertText("!", 2));

    expect(seen.some((event) => event.instanceId === "a" && event.modified)).toBe(true);
  });

  it("says nothing on open, however the document arrives", () => {
    const seen: SourcedBlockChangedEvent[] = [];
    editorWith(
      [blockJSON("a", "alpha", { outdated: true }), blockJSON("b", "beta")],
      recordingProvider(seen),
    );
    expect(seen).toEqual([]);
  });

  it("says nothing when the fact has not changed", () => {
    const seen: SourcedBlockChangedEvent[] = [];
    const editor = editorWith([blockJSON("a", "alpha")], recordingProvider(seen));

    editor.commands.setSourcedBlocksOutdated({ instanceIds: ["a"], outdated: true });
    expect(seen).toHaveLength(1);

    editor.commands.setSourcedBlocksOutdated({ instanceIds: ["a"], outdated: true });
    expect(seen).toHaveLength(1);
  });
});
