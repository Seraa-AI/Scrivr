import { describe, it, expect } from "vitest";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../../extensions/StarterKit";
import { SourcedBlockExtension } from "./SourcedBlock";
import type { SourceProvider } from "./SourcedBlock.types";

describe("SourcedBlock Insertion", () => {
  it("inserts a block, hashes content, and triggers registerInstance", () => {
    let registeredInstanceId: string | undefined;

    const mockProvider: SourceProvider = {
      kind: "clause",
      search: async () => [],
      fetch: async () => ({ resourceId: "", versionId: "", contentJSON: {}, label: "" }),
      registerInstance: async (event) => {
        registeredInstanceId = event.instanceId;
      },
    };

    const editor = new ServerEditor({
      extensions: [StarterKit, SourcedBlockExtension.configure({ providers: [mockProvider] })],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }] },
    });

    const success = editor.commands.insertSourcedBlock({
      kind: "clause",
      content: {
        resourceId: "cl_999",
        versionId: "v1",
        label: "Indemnity",
        contentJSON: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "New Clause" }] }],
        },
      },
    });

    const doc = editor.getState().doc;
    
    // We expect the original paragraph, and then the new sourcedBlock (since cursor was at start, 
    // replacing selection might push it, but actually `replaceSelectionWith` at the start of a doc 
    // might insert it before or after depending on selection. Since we didn't focus, selection is at 0.
    // Let's just find the sourcedBlock.
    let block: import("prosemirror-model").Node | undefined;
    doc.descendants((node) => {
      if (node.type.name === "sourcedBlock") {
        block = node;
      }
      return true;
    });

    if (!block) throw new Error("SourcedBlock not found");

    expect(block.type.name).toBe("sourcedBlock");
    expect(block.attrs["resourceId"]).toBe("cl_999");
    expect(typeof block.attrs["baseHash"]).toBe("string");
    expect(typeof block.attrs["instanceId"]).toBe("string");

    // Verify webhook was fired
    expect(registeredInstanceId).toBe(block.attrs["instanceId"]);
  });
});
