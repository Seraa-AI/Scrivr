/**
 * A suggestion is somebody's: the author it is computed for is the author its
 * tracked changes carry once it is applied — text and formatting alike — so a
 * reviewer sees which agent, or which person through it, proposed what.
 */
import { describe, expect, it } from "vitest";
import type { Node as PmNode } from "@scrivr/core/pm";
import { computeAiSuggestion } from "../computeAiSuggestion";
import { AiTestEditor, doc, p } from "./helpers";

const AUTHOR = "agent:legal-review";

/** The author ids on every tracked mark in the document. */
function trackedAuthors(root: PmNode): string[] {
  const authors = new Set<string>();
  root.descendants((node) => {
    for (const mark of node.marks) {
      // A text change holds one record; a formatting change, a list of them.
      const tracked: unknown = mark.attrs["dataTracked"];
      const records: unknown[] = Array.isArray(tracked) ? tracked : [tracked];
      for (const record of records) {
        if (typeof record === "object" && record !== null && "authorID" in record && typeof record.authorID === "string") {
          authors.add(record.authorID);
        }
      }
    }
  });
  return [...authors];
}

describe("a suggestion's author", () => {
  it("is carried on the suggestion it is computed for", () => {
    const editor = new AiTestEditor(doc(p("The quick fox", "n1")));
    const suggestion = computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "n1", proposedText: "The slow fox" }],
      authorID: AUTHOR,
    });
    expect(suggestion?.author).toBe(AUTHOR);
  });

  it("is the author of the text changes it applies as tracked", () => {
    const editor = new AiTestEditor(doc(p("The quick fox", "n1")));
    editor.showSuggestion(computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "n1", proposedText: "The slow fox" }],
      authorID: AUTHOR,
    }));
    editor.apply({ blockId: "n1", mode: "tracked" });
    expect(trackedAuthors(editor.getState().doc)).toEqual([AUTHOR]);
  });

  it("is the author of the formatting it applies as tracked", () => {
    const editor = new AiTestEditor(doc(p("plain and more", "n1")));
    editor.showSuggestion(computeAiSuggestion(editor.getState(), {
      blocks: [{ nodeId: "n1", proposedSpans: [
        { text: "plain ", marks: [] },
        { text: "and", marks: [{ type: "bold" }] },
        { text: " more", marks: [] },
      ] }],
      authorID: AUTHOR,
    }));
    editor.apply({ blockId: "n1", mode: "tracked" });
    expect(trackedAuthors(editor.getState().doc)).toEqual([AUTHOR]);
  });
});
