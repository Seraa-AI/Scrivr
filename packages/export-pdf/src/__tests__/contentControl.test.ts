/**
 * A content control prints as the box the canvas paints: a signer field's
 * outline and caption, an author checkbox's tick.
 */
import { describe, expect, it } from "vitest";
import { ContentControl, ServerEditor, StarterKit, type LayoutLine } from "@scrivr/core";
import { buildPdf } from "../index";
import { block, onePage, textLine } from "./fixtures";
import { recordDrawOps, type DrawOp } from "./opLog";

const editor = new ServerEditor({ extensions: [StarterKit, ContentControl] });
const contentControl = editor.schema.nodes["contentControl"]!;

async function printed(attrs: Record<string, unknown>): Promise<DrawOp[]> {
  const host = block("paragraph", [textLine("Signed:", { font: "16px Helvetica" })], { y: 100 });
  const line: LayoutLine = host.lines[0]!;
  line.spans.push({
    kind: "object",
    node: contentControl.create(attrs),
    docPos: 9,
    x: 80,
    width: 120,
    height: 30,
    verticalAlign: "baseline",
    font: "16px Helvetica",
  });
  const ops = await recordDrawOps(() => buildPdf(onePage([host]), editor));
  return ops.filter((op) => op.op !== "state" && !(op.op === "text" && op["value"] === "Signed:"));
}

describe("content controls in the PDF", () => {
  it("prints a signer field as a box captioned with its kind and role", async () => {
    const ops = await printed({ kind: "signature", fill: "signer", role: "client" });

    expect(ops.filter((op) => op.op === "rect")).toEqual(
      expect.arrayContaining([expect.objectContaining({ op: "rect", borderWidth: expect.any(Number) })]),
    );
    expect(ops.filter((op) => op.op === "text").map((op) => op["value"])).toEqual(["Signature · client"]);
  });

  it("prints an author's checked checkbox with its tick", async () => {
    const ops = await printed({ kind: "checkbox", fill: "author", checked: true });

    expect(ops.filter((op) => op.op === "line")).toHaveLength(2);
  });

  it("prints an unchecked checkbox as an empty box", async () => {
    const ops = await printed({ kind: "checkbox", fill: "author", checked: false });

    expect(ops.filter((op) => op.op === "line")).toEqual([]);
    expect(ops.filter((op) => op.op === "rect").length).toBeGreaterThan(0);
  });
});
