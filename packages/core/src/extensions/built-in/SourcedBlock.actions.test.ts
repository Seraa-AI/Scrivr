import { describe, it, expect, vi } from "vitest";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../../extensions/StarterKit";
import { SourcedBlockExtension } from "./SourcedBlock";
import type { SourceProvider } from "./SourcedBlock.types";
import { NodeSelection } from "prosemirror-state";
import { sourcedBlockDivergenceKey, NORMALIZER_VERSION, computeBlockHash } from "./sourcedBlockHashing";
import { NodeActionRegistry } from "../../selection/NodeActionRegistry";

describe("SourcedBlock Node Actions", () => {
  it("registers actions and handles permissions", async () => {
    const mockProvider: SourceProvider = {
      kind: "clause",
      search: async () => [],
      fetch: async () => ({ resourceId: "cl_1", versionId: "v1", label: "", contentJSON: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Latest Text" }] }] } }),
      registerInstance: async () => {},
      can: (capability) => capability !== "update", // update is forbidden, everything else allowed
    };

    const editor = new ServerEditor({
      extensions: [StarterKit, SourcedBlockExtension.configure({ providers: [mockProvider] })],
      content: {
        type: "doc",
        content: [
          {
            type: "sourcedBlock",
            attrs: {
              instanceId: "src_1",
              kind: "clause",
              resourceId: "cl_1",
              versionId: "v1",
              baseHash: "original_hash",
              baseNormalizer: NORMALIZER_VERSION,
            },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Modified Text" }] }]
          }
        ]
      },
    });

    // Create a NodeActionContext
    const state = editor.getState();
    const doc = state.doc;
    const blockPos = 0; // The sourcedBlock is at position 0
    const blockNode = doc.nodeAt(blockPos)!;
    expect(blockNode.type.name).toBe("sourcedBlock");
    
    // Set up a NodeSelection
    const tr = editor.getState().tr.setSelection(NodeSelection.create(doc, blockPos));
    editor.applyTransaction(tr);
    
    // Wait for the divergence plugin to hash the block so it marks it as modified
    await new Promise(resolve => setTimeout(resolve, 600));

    // Evaluate the registry
    const actionsHook = (SourcedBlockExtension as any).config.addNodeActions?.call({
      options: { providers: [mockProvider] },
      editor,
      schema: editor.schema,
    } as any);
    
    expect(actionsHook).toBeDefined();
    
    const registry = new NodeActionRegistry(actionsHook!);
    const ctx = {
      editor: editor as any,
      state: editor.getState(),
      descriptor: { kind: "node", surfaceId: "body", empty: false, capabilities: {} as any, anchor: blockPos, head: blockPos, from: blockPos, to: blockPos + blockNode.nodeSize },
      node: blockNode,
      pos: blockPos,
      readOnly: false
    };

    const resolved = registry.resolve(ctx as any);
    
    // Should resolve view, update, detach (3)
    // In ServerEditor, view.update never runs, so the divergence plugin never marks it modified.
    expect(resolved.map(a => a.id)).toEqual([
      "source.view",
      "source.update",
      "source.detach"
    ]);

    const updateAction = resolved.find(a => a.id === "source.update")!;
    expect(updateAction.disabledReason).toBe("Requires permission");

    // Test DETACH
    const detachAction = resolved.find(a => a.id === "source.detach")!;
    await detachAction.run(ctx as any);
    
    const docAfterDetach = editor.getState().doc;
    expect(docAfterDetach.firstChild?.type.name).toBe("paragraph");
    expect(docAfterDetach.firstChild?.textContent).toBe("Modified Text");
  });
});
