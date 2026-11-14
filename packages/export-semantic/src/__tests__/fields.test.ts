/** A block field is a unit of its own kind, so a reader can tell a templated section from prose. */
import { describe, expect, it } from "vitest";
import { Field, ServerEditor, StarterKit } from "@scrivr/core";
import { toSemanticUnits } from "../index";

describe("fields as semantic units", () => {
  it("names a block field's unit", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Field],
      content: {
        type: "doc",
        content: [{ type: "fieldBlock", content: [{ type: "paragraph", content: [{ type: "text", text: "Net 30" }] }] }],
      },
    });

    expect(toSemanticUnits(editor).map((unit) => unit.type)).toEqual(["fieldBlock"]);
  });
});
