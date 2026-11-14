// @vitest-environment happy-dom
/**
 * The executed document: the sealed snapshot with every party's values printed
 * in their fields — the signed record — and the hash of the bytes produced.
 */
import { describe, expect, it, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import {
  BUILT_IN_FIELD_KINDS,
  Extension,
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
import { exportExecutedPdf, type ExecutedPdfOptions, type ExecutedPdfRefusal, type ExecutedPdfResult } from "../index";
import { Plugin } from "@scrivr/core/pm";
import { recordDrawOps } from "./opLog";
import { createDefaultImageResolver } from "../fetchImage";

/** A real PNG, inline — what a signature pad gives. */
const samplePng = async (): Promise<string> => `data:image/png;base64,${createCanvas(40, 20).toBuffer("image/png").toString("base64")}`;

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
  const result = await createSnapshot(author.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });
  if (!result.ok) throw new Error(result.refusal.reason);
  return result.snapshot;
}

const signed: Record<string, FieldValue> = { sig: { kind: "text", text: "Ada Lovelace" } };
/** Real text metrics: happy-dom's canvas measures nothing. */
const measureContext = (ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext => ctx;
const measurer = () => new TextMeasurer({ lineHeightMultiplier: 1.2, context: measureContext(createCanvas(800, 600).getContext("2d")) });
const options: ExecutedPdfOptions = { editorOptions: { extensions: [StarterKit, Field], textMeasurer: measurer() } };

describe("exportExecutedPdf", () => {
  it("prints every party's values into the sealed document, with the hash of the bytes it returns", async () => {
    const snapshot = await sealed();
    let result: ExecutedPdfResult | undefined;
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

    const refusal: ExecutedPdfRefusal = { reason: "snapshot-altered" };
    expect(await exportExecutedPdf(altered, signed, options)).toEqual({ ok: false, refusal });
  });

  it("refuses while a required field is unanswered, naming it; an optional one may stay blank", async () => {
    const snapshot = await sealed();
    const result = await exportExecutedPdf(snapshot, { sig: { kind: "text", text: "  " } }, options);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.refusal.reason === "unanswered-fields" && result.refusal.missing.map((f) => f.id)).toEqual(["sig"]);
  });

  it("needs Field among the extensions, and says so before building an editor — even with no values to set", async () => {
    await expect(exportExecutedPdf(await sealed(), {}, { editorOptions: { extensions: [StarterKit], textMeasurer: measurer() } })).rejects.toThrow(
      /needs Field among editorOptions.extensions/,
    );
  });

  it("reports when another plugin refuses the complete value set", async () => {
    // A host plugin that lets nothing but edits through refuses Field's values.
    const editsOnly = Extension.create({ name: "editsOnly", addProseMirrorPlugins: () => [new Plugin({ filterTransaction: (tr) => tr.docChanged })] });
    const refusing: ExecutedPdfOptions = { editorOptions: { extensions: [StarterKit, Field, editsOnly], textMeasurer: measurer() } };

    await expect(exportExecutedPdf(await sealed(), signed, refusing)).rejects.toThrow(/could not hold the field values: a plugin refused them/);
  });

  it.each([{}, { sig: { kind: "image", src: "data:image/png;base64,iVBORw0KGgoAAAAAAAA" } }])(
    "never falls back to a configured signature when the supplied record cannot answer it (%j)",
    async (values) => {
      const configured: ExecutedPdfOptions = {
        editorOptions: { extensions: [StarterKit, Field.configure({ values: signed })], textMeasurer: measurer() },
      };
      const result = await exportExecutedPdf(await sealed(), values as Record<string, FieldValue>, configured);
      expect(!result.ok && result.refusal.reason === "unanswered-fields" && result.refusal.missing.map((f) => f.id)).toEqual(["sig"]);
    },
  );

  it("prints only supplied values, leaving configured optional answers out", async () => {
    const snapshot = await sealed();
    const ops = await recordDrawOps(async () => {
      const result = await exportExecutedPdf(snapshot, signed, { editorOptions: {
        extensions: [StarterKit, Field.configure({ values: { email: { kind: "text", text: "old@example.com" } } })],
        textMeasurer: measurer(),
      } });
      expect(result.ok).toBe(true);
      return result.ok ? result.pdf : new Uint8Array();
    });
    const texts = ops.filter((op) => op.op === "text").map((op) => op["value"]);
    expect(texts).toContain("Ada Lovelace");
    expect(texts).not.toContain("old@example.com");
  });

  it("checks the values it prints: a drawing the page may not draw is no signature", async () => {
    const result = await exportExecutedPdf(await sealed(), { sig: { kind: "image", src: "data:image/svg+xml;base64,PHN2Zy8+" } }, options);

    expect(!result.ok && result.refusal.reason === "unanswered-fields" && result.refusal.missing.map((f) => f.id)).toEqual(["sig"]);
  });

  it("prints a date signed only beside its party's signature", async () => {
    const author = new ServerEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "paragraph", content: [signer("sig", "signature", "client", false), signer("dated", "dateSigned", "client", false)] }] },
    });
    const made = await createSnapshot(author.getState().doc, { assignedRoles: ["client"], kinds: BUILT_IN_FIELD_KINDS });
    if (!made.ok) throw new Error(made.refusal.reason);
    const texts = async (values: Record<string, FieldValue>) =>
      (
        await recordDrawOps(async () => {
          const result = await exportExecutedPdf(made.snapshot, values, options);
          return result.ok ? result.pdf : new Uint8Array();
        })
      )
        .filter((op) => op.op === "text")
        .map((op) => op["value"]);
    const signedAt = "2026-11-14T09:30:00Z";

    expect(await texts({ sig: { kind: "text", text: "Ada Lovelace", signedAt } })).toContain("14 November 2026");
    // Signed late in the evening in New York: the record prints the signer's day, not the UTC one.
    expect(await texts({ sig: { kind: "text", text: "Ada Lovelace", signedAt: "2026-11-14T23:30:00-05:00" } })).toContain("14 November 2026");
    expect(await texts({ sig: { kind: "text", text: "  ", signedAt } })).not.toContain("14 November 2026");
    // A drawing the PDF cannot embed is no signature: its date does not print beside a blank line.
    expect(await texts({ sig: { kind: "image", src: "data:image/png;base64,iVBORw0KGgoAAAAAAAA", signedAt } })).not.toContain("14 November 2026");
  });

  it("checks the date it prints, in the host's format: one that gives nothing, or throws, leaves a required date unanswered", async () => {
    const author = new ServerEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "paragraph", content: [signer("sig", "signature", "client"), signer("dated", "dateSigned", "client")] }] },
    });
    const made = await createSnapshot(author.getState().doc, { assignedRoles: ["client"], kinds: BUILT_IN_FIELD_KINDS });
    if (!made.ok) throw new Error(made.refusal.reason);
    const signedBy = { sig: { kind: "text", text: "Ada", signedAt: "2026-11-14T09:30:00Z" } } satisfies Record<string, FieldValue>;
    const formatting = (formatSignedDate: (signedAt: string) => string): ExecutedPdfOptions => ({
      editorOptions: { extensions: [StarterKit, Field.configure({ formatSignedDate })], textMeasurer: measurer() },
    });
    const missing = (result: ExecutedPdfResult) => (!result.ok && result.refusal.reason === "unanswered-fields" ? result.refusal.missing.map((f) => f.id) : []);

    expect(missing(await exportExecutedPdf(made.snapshot, signedBy, formatting(() => "")))).toEqual(["dated"]);
    expect(
      missing(
        await exportExecutedPdf(made.snapshot, signedBy, formatting(() => {
          throw new RangeError("bad time zone");
        })),
      ),
    ).toEqual(["dated"]);
  });

  it("refuses a drawing whose bytes cannot even be decoded, rather than fail", async () => {
    const result = await exportExecutedPdf(await sealed(), { sig: { kind: "image", src: "data:image/png;base64,iVBORw0KGgoA1" } }, options);

    expect(!result.ok && result.refusal.reason === "unanswered-fields" && result.refusal.missing.map((f) => f.id)).toEqual(["sig"]);
  });

  it("resolves each drawing once, for the check and the print alike", async () => {
    const png = await samplePng();
    const resolveImage = vi.fn(createDefaultImageResolver());
    const result = await exportExecutedPdf(await sealed(), { sig: { kind: "image", src: png } }, { ...options, resolveImage });

    expect(result.ok).toBe(true);
    expect(resolveImage).toHaveBeenCalledTimes(1);
  });

  it("says plainly when the editor it was given cannot hold a value", async () => {
    const withoutFieldState = { editorOptions: { extensions: [StarterKit], textMeasurer: measurer() } };
    const plain = await createSnapshot(new ServerEditor({ extensions: [StarterKit] }).getState().doc, { assignedRoles: [], kinds: BUILT_IN_FIELD_KINDS });
    if (!plain.ok) throw new Error(plain.refusal.reason);

    await expect(exportExecutedPdf(plain.snapshot, signed, withoutFieldState)).rejects.toThrow(/needs Field/);
  });

  it("refuses a drawing it could not print, rather than print the signature blank", async () => {
    // Opens as a PNG, but is no image: the PDF could not embed it.
    const result = await exportExecutedPdf(await sealed(), { sig: { kind: "image", src: "data:image/png;base64,iVBORw0KGgoAAAAAAAA" } }, options);

    expect(!result.ok && result.refusal.reason === "unanswered-fields" && result.refusal.missing.map((f) => f.id)).toEqual(["sig"]);
  });

  it("never prints a value over what the author sealed", async () => {
    const author = new ServerEditor({
      extensions: [StarterKit, Field],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "field", attrs: { nodeId: "agreed", kind: "checkbox", fill: "author", checked: true } }] }] },
    });
    const sealedResult = await createSnapshot(author.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: [] });
    if (!sealedResult.ok) throw new Error(sealedResult.refusal.reason);

    const ops = await recordDrawOps(async () => {
      const result = await exportExecutedPdf(sealedResult.snapshot, { agreed: { kind: "checkbox", checked: false } }, options);
      return result.ok ? result.pdf : new Uint8Array();
    });

    // The author's tick: two strokes inside its box.
    expect(ops.filter((op) => op.op === "line")).toHaveLength(2);
  });
});
