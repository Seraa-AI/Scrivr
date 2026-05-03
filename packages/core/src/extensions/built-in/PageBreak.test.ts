import { describe, it, expect } from "vitest";
import { PageBreak } from "./PageBreak";
import { buildStarterKitContext } from "../../test-utils";

const { schema: fullSchema } = buildStarterKitContext();
const resolvedWithSchema = PageBreak.resolve(fullSchema);

describe("PageBreak — addNodes", () => {
  const resolved = PageBreak.resolve();

  it("registers exactly one node: pageBreak", () => {
    expect(Object.keys(resolved.nodes)).toEqual(["pageBreak"]);
  });

  it("pageBreak is in the block group", () => {
    const spec = resolved.nodes["pageBreak"]!;
    expect(spec.group).toContain("block");
  });

  it("pageBreak is an atom (leaf, no inline children)", () => {
    expect(resolved.nodes["pageBreak"]!.atom).toBe(true);
  });

  it("pageBreak is non-selectable so the cursor never parks on it", () => {
    expect(resolved.nodes["pageBreak"]!.selectable).toBe(false);
  });
});

describe("PageBreak — addCommands", () => {
  it("exposes an insertPageBreak command", () => {
    expect(resolvedWithSchema.commands["insertPageBreak"]).toBeDefined();
  });
});

describe("PageBreak — addKeymap", () => {
  it("binds Mod-Enter to the insert command", () => {
    expect(resolvedWithSchema.keymap["Mod-Enter"]).toBeDefined();
  });
});

describe("PageBreak — StarterKit integration", () => {
  it("the starter-kit schema includes the pageBreak node", () => {
    expect(fullSchema.nodes["pageBreak"]).toBeDefined();
  });

  it("pageBreak round-trips through schema.nodeFromJSON", () => {
    const node = fullSchema.nodeFromJSON({ type: "pageBreak" });
    expect(node.type.name).toBe("pageBreak");
  });
});
