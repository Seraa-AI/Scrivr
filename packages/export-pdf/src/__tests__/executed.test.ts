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
import { recordDrawOps, type DrawOp } from "./opLog";
import { createDefaultImageResolver } from "../fetchImage";

type Values = Record<string, FieldValue>;

/** A real PNG, inline — what a signature pad gives. */
const samplePng = (): string => `data:image/png;base64,${createCanvas(40, 20).toBuffer("image/png").toString("base64")}`;
/** Opens as a PNG, but is no image: the PDF cannot embed it. */
const brokenPng = "data:image/png;base64,iVBORw0KGgoAAAAAAAA";

const signer = (nodeId: string, kind: string, required = true) => ({ type: "field", attrs: { nodeId, kind, fill: "signer", role: "client", required } });
const paragraph = (...content: object[]) => ({ type: "paragraph", content });

/** `paragraphs` sealed with `assignedRoles` — the client unless said. */
async function sealedOf(paragraphs: object[], assignedRoles = ["client"]): Promise<SealedSnapshot> {
  const author = new ServerEditor({ extensions: [StarterKit, Field], content: { type: "doc", content: paragraphs } });
  const result = await createSnapshot(author.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles });
  if (!result.ok) throw new Error(result.refusal.reason);
  return result.snapshot;
}

/** A required signature and an optional email. */
const sealed = () =>
  sealedOf([
    paragraph({ type: "text", text: "Signed: " }, signer("sig", "signature")),
    paragraph({ type: "text", text: "Email: " }, signer("email", "email", false)),
  ]);

const signed: Values = { sig: { kind: "text", text: "Ada Lovelace" } };

/** Real text metrics: happy-dom's canvas measures nothing. */
const measureContext = (ctx: { font: string; measureText: (text: string) => TextMetrics }): TextMeasureContext => ctx;
const measurer = () => new TextMeasurer({ lineHeightMultiplier: 1.2, context: measureContext(createCanvas(800, 600).getContext("2d")) });
const printingWith = (...extensions: Extension[]): ExecutedPdfOptions => ({ editorOptions: { extensions: [StarterKit, ...extensions], textMeasurer: measurer() } });
const options = printingWith(Field);

/** The ids a refusal names as unanswered; `null` for any other result. */
const missingIds = (result: ExecutedPdfResult): string[] | null =>
  !result.ok && result.refusal.reason === "unanswered-fields" ? result.refusal.missing.map((f) => f.id) : null;

/** The executed PDF of `values`, and every draw call it makes. */
async function printed(snapshot: SealedSnapshot, values: Values, printing: ExecutedPdfOptions = options): Promise<{ result: ExecutedPdfResult; ops: DrawOp[] }> {
  let result: ExecutedPdfResult | undefined;
  const ops = await recordDrawOps(async () => {
    result = await exportExecutedPdf(snapshot, values, printing);
  });
  if (!result) throw new Error("exportExecutedPdf gave no result");
  return { result, ops };
}

const textsOf = (ops: DrawOp[]): unknown[] => ops.filter((op) => op.op === "text").map((op) => op["value"]);

describe("exportExecutedPdf", () => {
  it("returns the values it printed: a drawing as it embedded it, and none it could not embed", async () => {
    const drawing = samplePng();
    const snapshot = await sealedOf([
      paragraph(signer("sig", "signature")),
      paragraph(signer("initials", "initials", false)),
    ]);
    const { result } = await printed(snapshot, {
      sig: { kind: "image", src: `  ${drawing}\n`, signedAt: "2026-11-15T09:00:00Z" },
      initials: { kind: "image", src: brokenPng },
    });

    if (!result.ok) throw new Error("refused");
    expect(result.values).toEqual({ sig: { kind: "image", src: drawing, signedAt: "2026-11-15T09:00:00Z" } });
  });

  it("prints every party's values into the sealed document, with the hash of the bytes it returns", async () => {
    const { result, ops } = await printed(await sealed(), signed);

    if (!result.ok) throw new Error("refused");
    expect(result.artifactHash).toBe(await hashArtifact(result.pdf));
    expect(textsOf(ops)).toContain("Ada Lovelace");
  });

  it("refuses a snapshot that no longer matches its hash, rather than print a record of something else", async () => {
    const snapshot = await sealed();
    const altered = { ...snapshot, content: snapshot.content.replace("Signed: ", "Agreed: ") };

    const refusal: ExecutedPdfRefusal = { reason: "snapshot-altered" };
    expect(await exportExecutedPdf(altered, signed, options)).toEqual({ ok: false, refusal });
  });

  it("refuses while a required field is unanswered, naming it; an optional one may stay blank", async () => {
    expect(missingIds(await exportExecutedPdf(await sealed(), { sig: { kind: "text", text: "  " } }, options))).toEqual(["sig"]);
  });

  it("needs Field among the extensions, and says so before building an editor — even with no values to set", async () => {
    await expect(exportExecutedPdf(await sealed(), {}, printingWith())).rejects.toThrow(/needs Field among editorOptions.extensions/);
  });

  it("says plainly when the editor it was given cannot hold a value", async () => {
    const plain = await createSnapshot(new ServerEditor({ extensions: [StarterKit] }).getState().doc, { assignedRoles: [], kinds: BUILT_IN_FIELD_KINDS });
    if (!plain.ok) throw new Error(plain.refusal.reason);

    await expect(exportExecutedPdf(plain.snapshot, signed, printingWith())).rejects.toThrow(/needs Field/);
  });

  it("reports when another plugin refuses the complete value set", async () => {
    // A host plugin that lets nothing but edits through refuses Field's values.
    const editsOnly = Extension.create({ name: "editsOnly", addProseMirrorPlugins: () => [new Plugin({ filterTransaction: (tr) => tr.docChanged })] });

    await expect(exportExecutedPdf(await sealed(), signed, printingWith(Field, editsOnly))).rejects.toThrow(/could not hold the field values: a plugin refused them/);
  });

  it.each<Values>([{}, { sig: { kind: "image", src: brokenPng } }])(
    "never falls back to a configured signature when the supplied record cannot answer it (%j)",
    async (values) => {
      const configured = printingWith(Field.configure({ values: signed }));

      expect(missingIds(await exportExecutedPdf(await sealed(), values, configured))).toEqual(["sig"]);
    },
  );

  it("prints only supplied values, leaving configured optional answers out", async () => {
    const configured = printingWith(Field.configure({ values: { email: { kind: "text", text: "old@example.com" } } }));
    const { result, ops } = await printed(await sealed(), signed, configured);

    expect(result.ok).toBe(true);
    expect(textsOf(ops)).toContain("Ada Lovelace");
    expect(textsOf(ops)).not.toContain("old@example.com");
  });

  it("checks the values it prints: a drawing the page may not draw is no signature", async () => {
    const svg: Values = { sig: { kind: "image", src: "data:image/svg+xml;base64,PHN2Zy8+" } };

    expect(missingIds(await exportExecutedPdf(await sealed(), svg, options))).toEqual(["sig"]);
  });

  it("refuses a drawing whose bytes cannot even be decoded, rather than fail", async () => {
    const undecodable: Values = { sig: { kind: "image", src: "data:image/png;base64,iVBORw0KGgoA1" } };

    expect(missingIds(await exportExecutedPdf(await sealed(), undecodable, options))).toEqual(["sig"]);
  });

  it("refuses a drawing it could not print, rather than print the signature blank", async () => {
    expect(missingIds(await exportExecutedPdf(await sealed(), { sig: { kind: "image", src: brokenPng } }, options))).toEqual(["sig"]);
  });

  it("resolves each drawing once, for the check and the print alike", async () => {
    const resolveImage = vi.fn(createDefaultImageResolver());
    const result = await exportExecutedPdf(await sealed(), { sig: { kind: "image", src: samplePng() } }, { ...options, resolveImage });

    expect(result.ok).toBe(true);
    expect(resolveImage).toHaveBeenCalledTimes(1);
  });

  it("prints a date signed only beside its party's signature", async () => {
    const snapshot = await sealedOf([paragraph(signer("sig", "signature", false), signer("dated", "dateSigned", false))]);
    const texts = async (values: Values) => textsOf((await printed(snapshot, values)).ops);
    const signedAt = "2026-11-14T09:30:00Z";

    expect(await texts({ sig: { kind: "text", text: "Ada Lovelace", signedAt } })).toContain("14 November 2026");
    // Signed late in the evening in New York: the record prints the signer's day, not the UTC one.
    expect(await texts({ sig: { kind: "text", text: "Ada Lovelace", signedAt: "2026-11-14T23:30:00-05:00" } })).toContain("14 November 2026");
    expect(await texts({ sig: { kind: "text", text: "  ", signedAt } })).not.toContain("14 November 2026");
    // A drawing the PDF cannot embed is no signature: its date does not print beside a blank line.
    expect(await texts({ sig: { kind: "image", src: brokenPng, signedAt } })).not.toContain("14 November 2026");
  });

  it("checks the date it prints, in the host's format: one that gives nothing, or throws, leaves a required date unanswered", async () => {
    const snapshot = await sealedOf([paragraph(signer("sig", "signature"), signer("dated", "dateSigned"))]);
    const signedBy: Values = { sig: { kind: "text", text: "Ada", signedAt: "2026-11-14T09:30:00Z" } };
    const formatting = (formatSignedDate: (signedAt: string) => string) => printingWith(Field.configure({ formatSignedDate }));
    const throwing = () => {
      throw new RangeError("bad time zone");
    };

    expect(missingIds(await exportExecutedPdf(snapshot, signedBy, formatting(() => "")))).toEqual(["dated"]);
    expect(missingIds(await exportExecutedPdf(snapshot, signedBy, formatting(throwing)))).toEqual(["dated"]);
  });

  it("never prints a value over what the author sealed", async () => {
    const snapshot = await sealedOf([paragraph({ type: "field", attrs: { nodeId: "agreed", kind: "checkbox", fill: "author", checked: true } })], []);
    const { ops } = await printed(snapshot, { agreed: { kind: "checkbox", checked: false } });

    // The author's tick: two strokes inside its box.
    expect(ops.filter((op) => op.op === "line")).toHaveLength(2);
  });
});
