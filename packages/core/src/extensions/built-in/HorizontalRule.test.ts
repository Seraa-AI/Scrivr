import { describe, it, expect } from "vitest";
import { DOMParser as PMDOMParser, DOMSerializer } from "prosemirror-model";
import type { Node } from "prosemirror-model";
import { HorizontalRule } from "./HorizontalRule";
import { buildStarterKitContext } from "../../test-utils";

// Full schema is needed for phase-2 resolution (commands, inputRules)
const { schema: fullSchema } = buildStarterKitContext();
const resolvedWithSchema = HorizontalRule.resolve(fullSchema);

function firstOfType(node: Node, typeName: string): Node | null {
  let found: Node | null = null;
  node.descendants((n) => {
    if (found) return false;
    if (n.type.name === typeName) (found = n), false;
    return !found;
  });
  return found;
}

// ── nodeId round-trip (RFC 33: block ids must survive HTML parse) ──────────────

describe("HorizontalRule — nodeId round-trip", () => {
  it("declares a nodeId attr defaulting to null", () => {
    const spec = HorizontalRule.resolve().nodes["horizontalRule"]!;
    expect(spec.attrs?.["nodeId"]?.default).toBe(null);
  });

  it("preserves data-node-id through parse and re-serialize", () => {
    const div = document.createElement("div");
    div.innerHTML = '<hr data-node-id="hr-42">';
    const doc = PMDOMParser.fromSchema(fullSchema).parse(div);

    const hr = firstOfType(doc, "horizontalRule");
    expect(hr?.attrs["nodeId"]).toBe("hr-42");

    const out = document.createElement("div");
    out.appendChild(DOMSerializer.fromSchema(fullSchema).serializeFragment(doc.content));
    expect(out.querySelector("hr")?.getAttribute("data-node-id")).toBe("hr-42");
  });
});

// ── addNodes ──────────────────────────────────────────────────────────────────

describe("HorizontalRule — addNodes", () => {
  const resolved = HorizontalRule.resolve();

  it("registers exactly one node: horizontalRule", () => {
    expect(Object.keys(resolved.nodes)).toEqual(["horizontalRule"]);
  });

  it("horizontalRule is in the block group", () => {
    const spec = resolved.nodes["horizontalRule"]!;
    expect(spec.group).toContain("block");
  });

  it("horizontalRule has no content (leaf node)", () => {
    // content should be undefined or empty string — no inline children
    expect(spec_content(resolved.nodes["horizontalRule"]!)).toBeFalsy();
  });

  it("horizontalRule parses from <hr> tag", () => {
    const spec = resolved.nodes["horizontalRule"]!;
    const parseRule = spec.parseDOM?.[0];
    expect(parseRule).toBeDefined();
    expect((parseRule as { tag: string }).tag).toBe("hr");
  });
});

// ── addBlockStyles ────────────────────────────────────────────────────────────

describe("HorizontalRule — addBlockStyles", () => {
  const resolved = HorizontalRule.resolve();

  it("registers a block style keyed horizontalRule", () => {
    expect(resolved.blockStyles["horizontalRule"]).toBeDefined();
  });

  it("uses a small font so leaf block height is tight (≤ 16px)", () => {
    const font = resolved.blockStyles["horizontalRule"]!.font;
    // Extract the px size — must be ≤ 16 so the rendered block stays compact
    const match = font.match(/(\d+(?:\.\d+)?)px/);
    const size = match ? parseFloat(match[1]!) : Infinity;
    expect(size).toBeLessThanOrEqual(16);
  });

  it("spaceBefore and spaceAfter are ≥ 16 (comfortable spacing around the rule)", () => {
    const style = resolved.blockStyles["horizontalRule"]!;
    expect(style.spaceBefore).toBeGreaterThanOrEqual(16);
    expect(style.spaceAfter).toBeGreaterThanOrEqual(16);
  });
});

// ── addLayoutHandlers ─────────────────────────────────────────────────────────

describe("HorizontalRule — addLayoutHandlers", () => {
  it("registers a layout handler keyed horizontalRule", () => {
    const resolved = HorizontalRule.resolve();
    expect(resolved.layoutHandlers["horizontalRule"]).toBeDefined();
  });
});

// ── addMarkdownParserTokens ───────────────────────────────────────────────────

describe("HorizontalRule — addMarkdownParserTokens", () => {
  it("maps the hr markdown token to the horizontalRule node", () => {
    const resolved = HorizontalRule.resolve();
    expect(resolved.markdownParserTokens["hr"]).toEqual({ node: "horizontalRule" });
  });
});

// ── addCommands ───────────────────────────────────────────────────────────────

describe("HorizontalRule — addCommands", () => {
  it("exposes an insertHorizontalRule command (requires schema — phase 2)", () => {
    expect(resolvedWithSchema.commands["insertHorizontalRule"]).toBeDefined();
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function spec_content(spec: Record<string, unknown>): unknown {
  return spec["content"];
}
