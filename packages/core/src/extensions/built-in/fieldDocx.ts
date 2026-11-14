import type { Node as PmNode } from "prosemirror-model";
import { fieldCaption, fieldChoices, isDatedWhenSigned, type FieldChoice, type FieldControl, type FieldKinds, type FieldValue } from "./fieldKinds";
import {
  DOCX_TAG_MAX_LENGTH,
  xml,
  type DocxBlockTransform,
  type DocxContext,
  type DocxImportContext,
  type DocxInlineTransform,
  type DocxMarkTransform,
  type DocxNodeHandler,
  type DocxRunWrapper,
  type XmlNode,
} from "../../exports/docx";

const FIELD_TAG = "scrivr:field:";
const RANGE_TAG = "scrivr:fieldRange:";
const BLOCK_TAG = "scrivr:fieldBlock:";

/** Word's own wording for an empty text control, used when a prompt did not survive. */
const WORD_PROMPT = "Click or tap here to enter text.";

const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";
const V_NS = "urn:schemas-microsoft-com:vml";
const O_NS = "urn:schemas-microsoft-com:office:office";
const PX_TO_PT = 0.75;

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * A fresh `w:id` per control in one export. Word keeps only the last of two
 * controls sharing an id ([MS-OE376] §2.5.2.18) — a duplicate silently strips
 * the metadata a field comes back by.
 */
const nextIds = new WeakMap<DocxContext, number>();
function controlId(ctx: DocxContext): XmlNode {
  const id = (nextIds.get(ctx) ?? 0) + 1;
  nextIds.set(ctx, id);
  return xml("w:id", { "w:val": String(id) });
}

/** Scrivr's metadata as a `w:tag`, within OOXML's 255 characters. */
function tagFor(prefix: string, params: Record<string, string>, ctx: DocxContext): XmlNode {
  const entries = Object.entries(params).filter(([, value]) => value !== "");
  let tag = prefix + new URLSearchParams(entries).toString();
  if (tag.length > DOCX_TAG_MAX_LENGTH) {
    // The prompt is the one optional, unbounded part; without it the field
    // still comes back, showing Word's own prompt.
    tag = prefix + new URLSearchParams(entries.filter(([key]) => key !== "prompt")).toString();
    ctx.diagnostics.warn({
      code: "field-tag-too-long",
      message: `A field's prompt does not fit the ${DOCX_TAG_MAX_LENGTH}-character w:tag and was left out`,
    });
  }
  return xml("w:tag", { "w:val": tag });
}

const plainRun = (text: string): XmlNode => xml("w:r", undefined, [xml("w:t", { "xml:space": "preserve" }, [text])]);

const glyphRun = (glyph: string): XmlNode =>
  xml("w:r", undefined, [
    xml("w:rPr", undefined, [
      xml("w:rFonts", { "w:ascii": "MS Gothic", "w:hAnsi": "MS Gothic", "w:eastAsia": "MS Gothic" }),
    ]),
    xml("w:t", undefined, [glyph]),
  ]);

const braced = (id: string): string =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? `{${id.toUpperCase()}}`
    : `{${crypto.randomUUID().toUpperCase()}}`;

/**
 * Word's signature line. `issignatureline` is written out because Office
 * reads it as false when absent, against the standard ([MS-OE376] Part 4
 * §6.2.2.29); the GUID is what a Word signature is tied to.
 */
function signatureLine(node: PmNode, id: string): XmlNode {
  const width = Number(node.attrs["width"]) * PX_TO_PT;
  const height = Number(node.attrs["height"]) * PX_TO_PT;
  const role = node.attrs["role"];
  return xml("w:r", undefined, [
    xml("w:pict", undefined, [
      xml(
        "v:shape",
        { "xmlns:v": V_NS, "xmlns:o": O_NS, style: `width:${width}pt;height:${height}pt`, "o:allowincell": "f" },
        [
          xml("o:lock", {
            "v:ext": "edit",
            ungrouping: "t",
            rotation: "t",
            cropping: "t",
            verticies: "t",
            text: "t",
            grouping: "t",
          }),
          xml("o:signatureline", {
            "v:ext": "edit",
            id: braced(id),
            provid: "{00000000-0000-0000-0000-000000000000}",
            ...(typeof role === "string" ? { "o:suggestedsigner2": role } : {}),
            issignatureline: "t",
          }),
        ],
      ),
    ]),
  ]);
}

function checkbox(checked: boolean): XmlNode {
  return xml("w14:checkbox", { "xmlns:w14": W14_NS }, [
    xml("w14:checked", { "w14:val": checked ? "1" : "0" }),
    xml("w14:checkedState", { "w14:val": "2612", "w14:font": "MS Gothic" }),
    xml("w14:uncheckedState", { "w14:val": "2610", "w14:font": "MS Gothic" }),
  ]);
}

const dateControl = (): XmlNode =>
  xml("w:date", undefined, [xml("w:dateFormat", { "w:val": "yyyy-MM-dd" }), xml("w:lid", { "w:val": "en-US" })]);

const dropdown = (choices: readonly FieldChoice[]): XmlNode =>
  xml(
    "w:dropDownList",
    undefined,
    choices.map((choice) => xml("w:listItem", { "w:displayText": choice.label, "w:value": choice.id })),
  );

/** Each field as the control its kind declares; a kind Word has no control for is a text control. */
export const fieldDocx = (kinds: FieldKinds): DocxNodeHandler => (node, _children, ctx) => {
  const id = String(node.attrs["nodeId"] ?? "");
  const kind = String(node.attrs["kind"]);
  const caption = fieldCaption(kinds, node);
  const tag = tagFor(
    FIELD_TAG,
    {
      id,
      kind,
      fill: String(node.attrs["fill"]),
      role: typeof node.attrs["role"] === "string" ? node.attrs["role"] : "",
      required: node.attrs["required"] === true ? "1" : "",
      width: String(node.attrs["width"]),
      height: String(node.attrs["height"]),
    },
    ctx,
  );
  const checked = node.attrs["checked"] === true;
  const shapes: Record<FieldControl, () => { props: XmlNode[]; content: XmlNode }> = {
    signatureLine: () => ({ props: [], content: signatureLine(node, id) }),
    checkbox: () => ({ props: [checkbox(checked)], content: glyphRun(checked ? "☒" : "☐") }),
    // A date signed is the signing host's to fill, so Word locks what it holds.
    date: () => ({
      props: [...(isDatedWhenSigned(kinds, kind) ? [xml("w:lock", { "w:val": "contentLocked" })] : []), xml("w:showingPlcHdr"), dateControl()],
      content: plainRun(caption),
    }),
    dropdown: () => ({ props: [xml("w:showingPlcHdr"), dropdown(fieldChoices(node.attrs["options"]))], content: plainRun(caption) }),
    text: () => ({ props: [xml("w:showingPlcHdr"), xml("w:text")], content: plainRun(caption) }),
  };
  const { props, content } = shapes[kinds[kind]?.control ?? "text"]();
  return xml("w:sdt", undefined, [
    xml("w:sdtPr", undefined, [xml("w:alias", { "w:val": caption }), tag, controlId(ctx), ...props]),
    xml("w:sdtContent", undefined, [content]),
  ]);
};

export const fieldRangeWrapper: DocxRunWrapper = (runs, mark, ctx) => {
  const prompt = String(mark.attrs["prompt"] ?? "");
  const placeholder = mark.attrs["placeholder"] === true;
  return xml("w:sdt", undefined, [
    xml("w:sdtPr", undefined, [
      ...(prompt ? [xml("w:alias", { "w:val": prompt })] : []),
      tagFor(RANGE_TAG, { id: String(mark.attrs["nodeId"] ?? ""), kind: String(mark.attrs["kind"]), prompt }, ctx),
      controlId(ctx),
      ...(placeholder ? [xml("w:showingPlcHdr")] : []),
      mark.attrs["kind"] === "date" ? dateControl() : xml("w:text"),
    ]),
    xml("w:sdtContent", undefined, [...runs]),
  ]);
};

export const fieldBlockDocx: DocxNodeHandler = (node, children, ctx) => {
  const prompt = String(node.attrs["prompt"] ?? "");
  return xml("w:sdt", undefined, [
    xml("w:sdtPr", undefined, [
      ...(prompt ? [xml("w:alias", { "w:val": prompt })] : []),
      tagFor(BLOCK_TAG, { id: String(node.attrs["nodeId"] ?? ""), kind: String(node.attrs["kind"]), prompt }, ctx),
      controlId(ctx),
    ]),
    xml("w:sdtContent", undefined, children),
  ]);
};

// ── Import ──────────────────────────────────────────────────────────────────

const paramsOf = (tag: string | null, prefix: string): URLSearchParams | null =>
  tag?.startsWith(prefix) ? new URLSearchParams(tag.slice(prefix.length)) : null;

const FIELD_VALUES_KEY = "scrivr:fieldValues";

/**
 * What signers entered into fields' controls in Word, by field id. A signer's
 * value never enters the document, so the import hands these back beside it,
 * in the shape `Field.configure({ values })` takes.
 *
 * @internal How `importDocx` collects them; read `fieldValues` on its result.
 */
export const importedFieldValues = (ctx: DocxImportContext): Record<string, FieldValue> =>
  ctx.shared.get<Record<string, FieldValue>>(FIELD_VALUES_KEY) ?? {};

/**
 * The value a signer left in a control, or null when they left none. An
 * unticked box is how it was handed to them, so only a tick is an answer;
 * Word keeps a dropdown's label as its text, which names the choice.
 */
function controlValue(text: string, control: FieldControl, choices: readonly FieldChoice[]): FieldValue | null {
  if (control === "checkbox") return text.includes("☒") ? { kind: "checkbox", checked: true } : null;
  if (control === "dropdown") {
    const chosen = choices.find((choice) => choice.label.trim() === text);
    return chosen ? { kind: "choice", id: chosen.id } : null;
  }
  return text ? { kind: "text", text } : null;
}

export const fieldImport =
  (kinds: FieldKinds): DocxInlineTransform =>
  (inline, _marks, ctx) => {
    if (inline.type !== "sdt") return null;
    const params = paramsOf(inline.tag, FIELD_TAG);
    const type = ctx.schema.nodes["field"];
    if (!params || !type) return null;
    const fill = params.get("fill") === "author" ? "author" : "signer";
    const kind = params.get("kind") ?? "text";
    const text = inline.content.map((item) => (item.type === "text" ? item.text : "")).join("").trim();
    const id = params.get("id") || null;
    const options = inline.listItems.map((item) => ({ id: item.value, label: item.displayText }));
    // A date signed is dated by the signing host, never answered in Word.
    const answerable = fill === "signer" && id && !inline.placeholder && !isDatedWhenSigned(kinds, kind);
    const value = answerable ? controlValue(text, kinds[kind]?.control ?? "text", options) : null;
    if (value && id) ctx.shared.getOrInit<Record<string, FieldValue>>(FIELD_VALUES_KEY, () => ({}))[id] = value;
    if (fill === "signer" && !inline.placeholder && inline.content.some((item) => item.type === "image")) {
      ctx.diagnostics.warn({
        code: "field-drawing-not-imported",
        message: `A drawing in signer field "${id ?? ""}" was not brought back; signatures are captured by the signing host`,
      });
    }
    return type.create({
      nodeId: id,
      kind,
      fill,
      role: fill === "signer" ? params.get("role") : null,
      required: params.get("required") === "1",
      checked: fill === "author" && text.includes("☒"),
      options,
      ...(Number(params.get("width")) > 0 ? { width: Number(params.get("width")) } : {}),
      ...(Number(params.get("height")) > 0 ? { height: Number(params.get("height")) } : {}),
    });
  };

export const fieldRangeImport: DocxMarkTransform = (mark, ctx) => {
  const tag = mark.attrs?.["tag"];
  const params = paramsOf(typeof tag === "string" ? tag : null, RANGE_TAG);
  const type = ctx.schema.marks["fieldRange"];
  if (!params || !type) return null;
  return type.create({
    nodeId: params.get("id") || null,
    kind: params.get("kind") === "date" ? "date" : "text",
    prompt: params.get("prompt") ?? WORD_PROMPT,
    placeholder: mark.attrs?.["placeholder"] === true,
  });
};

export const fieldBlockImport: DocxBlockTransform = (block, content, ctx) => {
  if (block.type !== "sdt") return null;
  const params = paramsOf(block.tag, BLOCK_TAG);
  const type = ctx.schema.nodes["fieldBlock"];
  if (!params || !type || content.length === 0) return null;
  return type.create(
    {
      nodeId: params.get("id") || null,
      kind: params.get("kind") === "date" ? "date" : "text",
      prompt: params.get("prompt") ?? "",
    },
    content,
  );
};
