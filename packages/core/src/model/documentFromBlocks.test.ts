import { describe, expect, it } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
// Through the package barrel: what a host or another package imports.
import { documentFromBlocks } from "../index";

const open = (content: Record<string, unknown>) => new ServerEditor({ extensions: [StarterKit], content }).getState().doc;

describe("documentFromBlocks", () => {
  it("lays out titles, paragraphs, labelled lines and images as a document StarterKit opens", () => {
    const doc = open(
      documentFromBlocks([
        { title: "Certificate", level: 1 },
        { paragraph: "Checked when issued." },
        { label: "Agreed content", value: "sha256:abc" },
        { image: "data:image/png;base64,iVBORw0KGgo=", width: 132, height: 44 },
      ]),
    );

    expect(doc.childCount).toBe(4);
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(0).attrs["level"]).toBe(1);
    expect(doc.child(2).textContent).toBe("Agreed content: sha256:abc");
    expect(doc.child(2).firstChild?.marks.map((m) => m.type.name)).toEqual(["bold"]);
    expect(doc.child(3).firstChild?.attrs).toMatchObject({ width: 132, height: 44 });
  });

  it("never writes an empty text: blank words make an empty block, which still opens", () => {
    const doc = open(documentFromBlocks([{ title: "", level: 2 }, { paragraph: "" }, { label: "", value: "" }]));

    expect(doc.childCount).toBe(3);
    expect(doc.textContent).toBe("");
  });
});
