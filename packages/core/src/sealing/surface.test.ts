// Imported through the package barrel on purpose: these are what a signing
// host builds on, and `tsc` fails here the moment one stops being exported.
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FIELD_KINDS,
  Field,
  FieldChoiceSchema,
  ServerEditor,
  StarterKit,
  checkboxTick,
  contentHashOf,
  defaultSignedDate,
  createSnapshot,
  fieldDrawingAt,
  fieldIconStrokes,
  fieldInk,
  fieldKindsOf,
  fieldValueLayout,
  fieldValues,
  hashArtifact,
  isDatedWhenSigned,
  isDrawnKind,
  MAX_DRAWING_BYTES,
  isFieldAnswered,
  isSigningKind,
  listSignerFields,
  paintCheckbox,
  safeDrawingUrl,
  setFieldValue,
  unansweredBeforeSigning,
  valuesOnRecord,
  WORD_PART_NAMESPACES,
  verifySnapshot,
  type BuiltInFieldKind,
  type CreateSnapshotOptions,
  type HostSealRefusal,
  type SealCheck,
  type SealCheckSubject,
  type FieldBox,
  type FieldChoice,
  type FieldControl,
  type FieldKinds,
  type FieldFill,
  type FieldKind,
  type FieldKindSpec,
  type FieldOptions,
  type FieldRangeKind,
  type FieldValue,
  type InlineLine,
  type InsertFieldOptions,
  type InsertFieldRangeOptions,
  type MutationDenied,
  type MutationDenialReason,
  type MutationGate,
  type MutationOrigin,
  type SealRefusal,
  type SealedSnapshot,
  type SignerFieldDescriptor,
  type SnapshotResult,
} from "../index";

describe("what a signing host builds on", () => {
  it("is reachable from the package: fields, the seal, and its refusals", async () => {
    const kind: BuiltInFieldKind = "signature";
    const control: FieldControl = BUILT_IN_FIELD_KINDS[kind].control ?? "text";
    const choice: FieldChoice = FieldChoiceSchema.parse({ id: "net-30", label: "Net 30" });
    const spec = { label: "Agree", size: { width: 16, height: 16 }, control: "checkbox" } satisfies FieldKindSpec;
    const drawnSpec = { label: "Stamp", size: { width: 120, height: 120 }, drawn: true, verb: "Stamp" } satisfies FieldKindSpec;
    expect(isDrawnKind({ ...BUILT_IN_FIELD_KINDS, stamp: drawnSpec }, "stamp")).toBe(true);
    const options = { kinds: { agree: spec }, values: {} } satisfies FieldOptions;
    const insert = { kind: "dropdown" satisfies FieldKind, fill: "signer" satisfies FieldFill, role: "client", options: [choice] } satisfies InsertFieldOptions;
    const range = { kind: "text" satisfies FieldRangeKind, prompt: "Client name" } satisfies InsertFieldRangeOptions;
    const value: FieldValue = { kind: "text", text: "Ada" };
    const denied = { reason: "sealed" satisfies MutationDenialReason, origin: "remote" satisfies MutationOrigin } satisfies MutationDenied;
    const gate: MutationGate = (state, tr) => state.apply(tr);

    const editor = new ServerEditor({ extensions: [StarterKit, Field.configure(options)] });
    const doc = editor.getState().doc;
    const fields: SignerFieldDescriptor[] = listSignerFields(doc);
    const signingOrder: SealCheck = ({ fields: sealed }: SealCheckSubject): HostSealRefusal | null =>
      sealed.length > 99 ? { reason: "host", code: "too-many", message: "Too many signers." } : null;
    const snapshotOptions: CreateSnapshotOptions = { assignedRoles: [], checks: { after: [signingOrder] }, kinds: fieldKindsOf(editor) };
    const result: SnapshotResult = await createSnapshot(doc, snapshotOptions);
    const snapshot: SealedSnapshot | null = result.ok ? result.snapshot : null;
    const refusal: SealRefusal | null = result.ok ? null : result.refusal;

    expect(snapshot && (await verifySnapshot(snapshot.content, snapshot.contentHash))).toBe(true);
    expect(snapshot?.contentHash).toBe(await contentHashOf(doc));
    expect(await hashArtifact(new Uint8Array([1]))).toMatch(/^sha256:/);
    expect(checkboxTick({ x: 0, y: 0, width: 10, height: 10 })).toHaveLength(3);
    const box: FieldBox = { x: 0, y: 0, width: 180, height: 24 };
    const line: InlineLine = { baselineY: 20, font: "14px Inter" };
    expect(fieldValueLayout(box, line.font, line.baselineY).sizePx).toBe(14);
    expect(fieldInk(box).labelSizePx).toBeGreaterThan(0);
    expect(fieldIconStrokes("date", fieldInk(box).icon).length).toBeGreaterThan(0);
    expect(setFieldValue(editor, "f", value)).toBe(true);
    expect(fieldValues(editor.getState())).toEqual({ f: value });
    expect(fieldDrawingAt(editor, 0, { box, baselineY: 20, theme: editor.getResolvedTheme() })).toBeNull();
    expect(typeof paintCheckbox).toBe("function");
    const terms: SignerFieldDescriptor = { id: "t", role: "client", kind: "dropdown", required: true, options: [] };
    const kinds: FieldKinds = fieldKindsOf(editor);
    expect(isFieldAnswered(terms, undefined, kinds)).toBe(false);
    expect(unansweredBeforeSigning([terms], {}, "client", kinds)).toEqual([terms]);
    expect(valuesOnRecord([terms], {}, kinds)).toEqual({});
    expect(safeDrawingUrl("data:image/png;base64,iVBORw0KGgo=")).not.toBeNull();
    expect(MAX_DRAWING_BYTES).toBeGreaterThan(0);
    expect(defaultSignedDate("2026-11-14T09:30:00Z")).toBe("14 November 2026");
    expect(WORD_PART_NAMESPACES["mc:Ignorable"]).toBe("w14");
    expect(isSigningKind(BUILT_IN_FIELD_KINDS, "signature") && isDatedWhenSigned(BUILT_IN_FIELD_KINDS, "dateSigned")).toBe(true);
    expect([control, insert.kind, range.kind, denied.reason, typeof gate, fields, refusal]).toEqual([
      "signatureLine",
      "dropdown",
      "text",
      "sealed",
      "function",
      [],
      null,
    ]);
  });
});
