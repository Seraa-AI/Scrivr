// @vitest-environment happy-dom
/**
 * The executed document: the sealed snapshot with every party's values printed
 * in their fields — the signed record — and the hash of the bytes produced.
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  Field,
  ServerEditor,
  StarterKit,
  TextMeasurer,
  createSnapshot,
  hashArtifact,
  type FieldValue,
  type SealedSnapshot,
  type TextMeasureContext,
} from "@scrivr/core";
import { exportExecutedPdf } from "../index";
import { recordDrawOps } from "./opLog";

const signer = (nodeId: string, kind: string, role: string, required = true) => ({
  type: "field",
  attrs: { nodeId, kind, fill: "signer", role, required },
});

async function sealed(): Promise<SealedSnapshot> {
  const author = new ServerEditor({
    extensions: [StarterKit, Field],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Signed: " }, signer("sig", "signature", "client")] },
        { type: "paragraph", content: [{ type: "text", text: "Email: " }, signer("email", "email", "client", false)] },
      ],
    },
  });
  const result = await createSnapshot(author.getState().doc, { assignedRoles: ["client"] });
  if (!result.ok) throw new Error(result.refusal.reason);
  return result.snapshot;
}

const signed: Record<string, FieldValue> = { sig: { kind: "text", text: "Ada Lovelace" } };
/** Real text metrics: happy-dom's canvas measures nothing. */
const measureContext = (ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext => ctx;
const measurer = () => new TextMeasurer({ lineHeightMultiplier: 1.2, context: measureContext(createCanvas(800, 600).getContext("2d")) });
const options = { editor: { extensions: [StarterKit, Field], textMeasurer: measurer() } };

describe("exportExecutedPdf", () => {
  it("prints every party's values into the sealed document, with the hash of the bytes it returns", async () => {
    const snapshot = await sealed();
    let result: Awaited<ReturnType<typeof exportExecutedPdf>> | undefined;
    const ops = await recordDrawOps(async () => {
      result = await exportExecutedPdf(snapshot, signed, options);
      return result.ok ? result.pdf : new Uint8Array();
    });

    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.artifactHash).toBe(await hashArtifact(result.pdf));
    expect(ops.filter((op) => op.op === "text").map((op) => op["value"])).toContain("Ada Lovelace");
  });

  it("refuses a snapshot that no longer matches its hash, rather than print a record of something else", async () => {
    const snapshot = await sealed();
    const altered = { ...snapshot, content: snapshot.content.replace("Signed: ", "Agreed: ") };

    expect(await exportExecutedPdf(altered, signed, options)).toEqual({ ok: false, refusal: { reason: "snapshot-altered" } });
  });

  it("refuses while a required field is unanswered, naming it; an optional one may stay blank", async () => {
    const snapshot = await sealed();
    const result = await exportExecutedPdf(snapshot, { sig: { kind: "text", text: "  " } }, options);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.refusal.reason === "unanswered-fields" && result.refusal.missing.map((f) => f.id)).toEqual(["sig"]);
  });

  it("needs Field among the extensions, since nothing else can read the fields or print a value", async () => {
    await expect(exportExecutedPdf(await sealed(), signed, { editor: { extensions: [StarterKit], textMeasurer: measurer() } })).rejects.toThrow(/field/i);
  });
});
