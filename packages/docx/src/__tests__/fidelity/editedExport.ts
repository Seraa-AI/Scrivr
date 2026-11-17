import { ServerEditor } from "@scrivr/core";
import { TextSelection, type Node as PmNode } from "@scrivr/core/pm";
import { findChild, parseOoxml, type OoxmlElement } from "../../import/xml";
import { alignInOrder } from "./align";
import { fidelityExtensions } from "./fixtures";
import { canonical, type WordParagraph } from "./wordReference";

/**
 * How much of an edited Word document comes back from Scrivr as Word had it.
 *
 * Each fixture is given the edits a user would make — bold a word, add a
 * paragraph in the middle, type one at the end — pressing Enter and toggling
 * bold through the editor's own keymap and commands. The export is then
 * compared with the original file paragraph by paragraph.
 */

export const TYPED_AT_END = "Typed at the end by the fidelity suite.";
export const INSERTED_IN_MIDDLE = "Inserted in the middle by the fidelity suite.";

/** An editor that can press a key the way a user does: through its keymap. */
export class ScriptedEditor extends ServerEditor {
  constructor(doc: PmNode) {
    super({ extensions: fidelityExtensions(), content: doc.toJSON() });
  }

  /** Run the command the editor binds to `key`, as a keypress would. */
  press(key: string): void {
    const command = this.manager.buildKeymap()[key];
    if (!command || !command(this.getState(), (tr) => this.applyTransaction(tr))) {
      throw new Error(`"${key}" did nothing`);
    }
  }

  /** Type `text` at the selection, taking the marks a keystroke would. */
  type(text: string): void {
    this.applyTransaction(this.getState().tr.insertText(text));
  }

  select(from: number, to = from): void {
    const state = this.getState();
    this.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  }
}

/** The word the bold edit changed, and the text of the paragraph it is in. */
export interface BoldEdit {
  word: string;
  paragraph: string;
}

/**
 * Bold one word, insert a paragraph after one in the middle, and type a new
 * paragraph at the end. Bolding comes first, so the paragraphs it chooses
 * from are the document's own. Returns the bold edit, or `null` for a
 * document with no unbolded word in a body paragraph to bold.
 */
export function applyScriptedEdits(editor: ScriptedEditor): BoldEdit | null {
  const bold = boldOneWord(editor);
  const paragraphs = topLevelTextParagraphs(editor.getState().doc);
  const middle = paragraphs[Math.floor(paragraphs.length / 2)];
  if (middle) {
    editor.select(middle.end);
    editor.press("Enter");
    editor.type(INSERTED_IN_MIDDLE);
  }
  editor.select(lastTextblockEnd(editor.getState().doc));
  editor.press("Enter");
  editor.type(TYPED_AT_END);
  return bold;
}

function boldOneWord(editor: ScriptedEditor): BoldEdit | null {
  for (const paragraph of topLevelTextParagraphs(editor.getState().doc)) {
    let offset = 0;
    for (let i = 0; i < paragraph.node.childCount; i++) {
      const child = paragraph.node.child(i);
      const match =
        child.isText && !child.marks.some((m) => m.type.name === "bold") ? /[A-Za-z]{4,}/.exec(child.text ?? "") : null;
      if (match) {
        const from = paragraph.start + offset + match.index;
        editor.select(from, from + match[0].length);
        if (!editor.commands.toggleBold()) throw new Error(`could not bold "${match[0]}"`);
        return { word: match[0], paragraph: paragraph.node.textContent };
      }
      offset += child.nodeSize;
    }
  }
  return null;
}

interface PlacedParagraph {
  node: PmNode;
  /** Position of its first character. */
  start: number;
  /** Position after its last character. */
  end: number;
}

/** Paragraphs directly in the document body that hold text. */
function topLevelTextParagraphs(doc: PmNode): PlacedParagraph[] {
  const out: PlacedParagraph[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "paragraph" && node.textContent.trim().length > 0) {
      out.push({ node, start: offset + 1, end: offset + 1 + node.content.size });
    }
  });
  return out;
}

function lastTextblockEnd(doc: PmNode): number {
  let end = -1;
  doc.descendants((node, pos) => {
    if (node.isTextblock) end = pos + 1 + node.content.size;
  });
  if (end < 0) throw new Error("document has no text block to type into");
  return end;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export interface EditedScores {
  /** Paragraphs the edits did not touch that kept Word's formatting, of all untouched paragraphs. */
  untouched: [preserved: number, of: number];
  /**
   * Edits that took the formatting around them, of the three. A document with
   * no word to bold, or no body paragraph to insert after, cannot reach three.
   */
  edits: [matching: number, of: number];
}

/**
 * Compare an export with the original. Paragraphs are paired by text, in
 * order, so a paragraph Scrivr dropped or added does not shift every pair
 * after it; one Scrivr dropped is unpaired, and so not preserved.
 */
export function scoreEditedExport(
  original: readonly WordParagraph[],
  exported: readonly WordParagraph[],
  bold: BoldEdit | null,
): EditedScores {
  const pairs = alignInOrder(original, exported, (p) => p.text);
  const isBolded = (p: WordParagraph) => bold !== null && p.text === bold.paragraph;
  let preserved = 0;
  for (const [o, e] of pairs) {
    if (!isBolded(original[o]!) && sameFormatting(original[o]!, exported[e]!)) preserved++;
  }

  let matching = 0;
  for (const added of [INSERTED_IN_MIDDLE, TYPED_AT_END]) {
    const at = exported.findIndex((p) => p.text === added);
    // The paragraph it was split from is the one before it, and that one is Word's.
    const source = at > 0 ? pairs.find(([, e]) => e === at - 1) : undefined;
    if (source && formatOf(exported[at]!) === formatOf(original[source[0]]!)) matching++;
  }
  if (bold !== null && boldKeptTheRest(original, exported, bold)) matching++;

  return { untouched: [preserved, original.filter((p) => !isBolded(p)).length], edits: [matching, 3] };
}

function sameFormatting(a: WordParagraph, b: WordParagraph): boolean {
  if (a.pPr !== b.pPr || a.segments.length !== b.segments.length) return false;
  return a.segments.every((s, i) => s.text === b.segments[i]!.text && s.rPr === b.segments[i]!.rPr);
}

/** The style, face and size a paragraph's first text is set in. */
function formatOf(p: WordParagraph): string {
  const pPr = parseOoxml(p.pPr);
  const rPr = parseOoxml(p.segments[0]?.rPr ?? "");
  const style = pPr && findChild(pPr, "w:pStyle")?.attrs["w:val"];
  const fonts = rPr && findChild(rPr, "w:rFonts")?.attrs["w:ascii"];
  const size = rPr && findChild(rPr, "w:sz")?.attrs["w:val"];
  return `${style ?? ""}|${fonts ?? ""}|${size ?? ""}`;
}

/** The bolded word kept every run property it had, and gained bold. */
function boldKeptTheRest(original: readonly WordParagraph[], exported: readonly WordParagraph[], bold: BoldEdit): boolean {
  const inParagraph = (paragraphs: readonly WordParagraph[]) =>
    paragraphs.find((p) => p.text === bold.paragraph)?.segments.filter((s) => s.text.includes(bold.word)) ?? [];
  const before = inParagraph(original).find((s) => !isBold(s.rPr));
  const after = inParagraph(exported).find((s) => isBold(s.rPr));
  if (!before || !after) return false;
  return canonicalWithout(after.rPr, BOLD) === canonicalWithout(before.rPr, BOLD);
}

const BOLD = new Set(["w:b", "w:bCs"]);

function isBold(rPr: string): boolean {
  const el = parseOoxml(rPr);
  return el !== null && findChild(el, "w:b") !== undefined;
}

function canonicalWithout(rPr: string, names: ReadonlySet<string>): string {
  const el = parseOoxml(rPr);
  if (!el) return rPr;
  const kept: OoxmlElement = {
    ...el,
    children: el.children.filter((c) => typeof c === "string" || !names.has(c.name)),
  };
  return canonical(kept);
}
