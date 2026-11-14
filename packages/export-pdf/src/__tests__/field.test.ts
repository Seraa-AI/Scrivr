/**
 * A field prints as the canvas paints it: a signer field's rule and caption,
 * an author checkbox's tick, and in the executed document the value it holds.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { Field, ServerEditor, StarterKit, type LayoutLine } from "@scrivr/core";
import { buildPdf } from "../index";
import { block, onePage, textLine } from "./fixtures";
import { recordDrawOps, type DrawOp } from "./opLog";

const editor = new ServerEditor({ extensions: [StarterKit, Field] });
const field = editor.schema.nodes["field"]!;

async function printed(attrs: Record<string, unknown>, by = editor): Promise<DrawOp[]> {
  const host = block("paragraph", [textLine("Signed:", { font: "16px Helvetica" })], { y: 100 });
  const line: LayoutLine = host.lines[0]!;
  line.spans.push({
    kind: "object",
    node: by.schema.nodes["field"]!.create(attrs),
    docPos: 9,
    x: 80,
    width: 120,
    height: 30,
    verticalAlign: "baseline",
    font: "16px Helvetica",
  });
  const ops = await recordDrawOps(() => buildPdf(onePage([host]), by));
  return ops.filter((op) => op.op !== "state" && !(op.op === "text" && op["value"] === "Signed:"));
}

describe("fields in the PDF", () => {
  it("prints a signer field as a blank on a form: its line, and what goes on it and whose it is", async () => {
    const ops = await printed({ kind: "signature", fill: "signer", role: "client" });

    // No box around it — the page's own background is the only rect.
    expect(ops.filter((op) => op.op === "rect" && op["borderWidth"] !== undefined)).toEqual([]);
    expect(ops.filter((op) => op.op === "line").length).toBeGreaterThan(0);
    // A printed page may have no colour, so it names the party too.
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

describe("an author's text field in the PDF", () => {
  async function colourOf(placeholder: boolean): Promise<unknown> {
    const line = textLine("Client name", {
      font: "16px Helvetica",
      marks: [{ name: "fieldRange", attrs: { nodeId: "f1", kind: "text", prompt: "Client name", placeholder } }],
    });
    const ops = await recordDrawOps(() => buildPdf(onePage([block("paragraph", [line], { y: 100 })]), editor));
    return ops.find((op) => op.op === "text" && op["value"] === "Client name")?.["color"];
  }

  it("prints placeholder text in the placeholder colour, and filled text as text", async () => {
    const placeholder = await colourOf(true);
    const filled = await colourOf(false);

    expect(placeholder).toBeDefined();
    expect(placeholder).not.toEqual(filled);
  });

  it("prints its prompt on a rule like every other blank, and filled text without one", async () => {
    const rules = async (placeholder: boolean) => {
      const line = textLine("Client name", {
        font: "16px Helvetica",
        marks: [{ name: "fieldRange", attrs: { nodeId: "f1", kind: "text", prompt: "Client name", placeholder } }],
      });
      const ops = await recordDrawOps(() => buildPdf(onePage([block("paragraph", [line], { y: 100 })]), editor));
      return ops.filter((op) => op.op === "line").length;
    };

    expect(await rules(true)).toBeGreaterThan(0);
    expect(await rules(false)).toBe(0);
  });
});

describe("the executed document: values printed in their fields", () => {
  /** A drawn signature twice as wide as it is tall. */
  const signaturePng = `data:image/png;base64,${createCanvas(40, 20).toBuffer("image/png").toString("base64")}`;
  const executed = new ServerEditor({
    extensions: [
      StarterKit,
      Field.configure({
        values: {
          typed: { kind: "text", text: "Ada Lovelace" },
          drawn: { kind: "image", src: signaturePng },
          ticked: { kind: "checkbox", checked: true },
          chosen: { kind: "choice", id: "net-60" },
        },
      }),
    ],
  });
  const signer = (nodeId: string, kind = "signature") => ({ nodeId, kind, fill: "signer", role: "client" });

  it("prints a typed value in place of the empty field's caption", async () => {
    const texts = (await printed(signer("typed", "name"), executed)).filter((op) => op.op === "text");

    expect(texts.map((op) => op["value"])).toEqual(["Ada Lovelace"]);
    // In the size of the text around it: 16px is 12pt.
    expect(Number(texts[0]!["size"])).toBeCloseTo(12, 5);
  });

  it("prints the label of the choice a signer made", async () => {
    const options = [{ id: "net-30", label: "Net 30" }, { id: "net-60", label: "Net 60" }];
    const texts = (await printed({ ...signer("chosen", "dropdown"), options }, executed)).filter((op) => op.op === "text");

    expect(texts.map((op) => op["value"])).toEqual(["Net 60"]);
  });

  it("prints a drawn signature in its box, keeping its proportions", async () => {
    const [image] = (await printed(signer("drawn"), executed)).filter((op) => op.op === "image");

    expect(image).toBeDefined();
    expect(Number(image!["width"]) / Number(image!["height"])).toBeCloseTo(2, 2);
    expect(Number(image!["height"])).toBeLessThanOrEqual(30 * 0.75 + 0.01);
  });

  it("prints a signer's checked box with its tick", async () => {
    const ops = await printed(signer("ticked", "checkbox"), executed);

    expect(ops.filter((op) => op.op === "line")).toHaveLength(2);
  });

  it("prints a field nobody completed as the empty field", async () => {
    const texts = (await printed(signer("unsigned"), executed)).filter((op) => op.op === "text").map((op) => op["value"]);

    expect(texts).toEqual(["Signature · client"]);
  });
});
