import { describe, it, expect } from "vitest";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../../extensions/StarterKit";
import { SourcedBlockExtension } from "./SourcedBlock";

describe("clone mode — SourcedBlockExtension", () => {
  it("re-mints instanceId of sourcedBlocks but preserves provenance", () => {
    const CONTENT = {
      type: "doc",
      content: [
        {
          type: "sourcedBlock",
          attrs: {
            instanceId: "src_original_123",
            kind: "clause",
            resourceId: "cl_456",
            versionId: "v1",
            baseHash: "abc",
            baseNormalizer: 1,
          },
          content: [{ type: "paragraph", content: [{ type: "text", text: "alpha" }] }],
        },
      ],
    };

    const editor = new ServerEditor({
      extensions: [StarterKit, SourcedBlockExtension],
      content: CONTENT,
      clone: true,
    });

    const doc = editor.getState().doc;
    const block = doc.child(0);

    expect(block.type.name).toBe("sourcedBlock");
    
    const attrs = block.attrs;
    // The new instanceId should be reminted and recorded in the clone map
    expect(attrs["instanceId"]).not.toBe("src_original_123");
    expect(typeof attrs["instanceId"]).toBe("string");
    
    // Check that map contains the mapping
    const map = editor.cloneIdMap;
    expect(map).not.toBeNull();
    const newId = map!.getByType("src_original_123", "sourcedBlock", "custom");
    expect(newId).toBe(attrs["instanceId"]);

    // The other attributes must be preserved exactly
    expect(attrs["kind"]).toBe("clause");
    expect(attrs["resourceId"]).toBe("cl_456");
    expect(attrs["versionId"]).toBe("v1");
    expect(attrs["baseHash"]).toBe("abc");
    expect(attrs["baseNormalizer"]).toBe(1);
  });
});
