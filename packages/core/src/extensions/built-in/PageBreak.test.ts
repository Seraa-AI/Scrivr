import { describe, it, expect } from "vitest";
import { DOMParser as PMDOMParser, DOMSerializer } from "prosemirror-model";
import type { Node } from "prosemirror-model";
import { PageBreak } from "./PageBreak";
import { buildStarterKitContext } from "../../test-utils";

const { schema: fullSchema } = buildStarterKitContext();
const resolvedWithSchema = PageBreak.resolve(fullSchema);

describe("PageBreak — nodeId round-trip", () => {
  it("declares a nodeId attr defaulting to null", () => {
    expect(PageBreak.resolve().nodes["pageBreak"]!.attrs?.["nodeId"]?.default).toBe(null);
  });

  it("preserves data-node-id through parse and re-serialize", () => {
    const div = document.createElement("div");
    div.innerHTML = '<div class="scrivr-page-break" data-node-id="pb-7"></div>';
    const doc = PMDOMParser.fromSchema(fullSchema).parse(div);

    let pb: Node | null = null;
    doc.descendants((n) => {
      if (!pb && n.type.name === "pageBreak") pb = n;
      return !pb;
    });
    expect(pb!.attrs["nodeId"]).toBe("pb-7");

    const out = document.createElement("div");
    out.appendChild(DOMSerializer.fromSchema(fullSchema).serializeFragment(doc.content));
    expect(out.querySelector(".scrivr-page-break")?.getAttribute("data-node-id")).toBe("pb-7");
  });
});

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
