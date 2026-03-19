import { describe, it, expect } from "vitest";
import { schema } from "./schema";

describe("schema — nodes", () => {
  it("has a doc node that accepts blocks", () => {
    expect(schema.nodes["doc"]).toBeDefined();
  });

  it("has all required block node types", () => {
    const required = [
      "paragraph",
      "heading",
      "bullet_list",
      "ordered_list",
      "list_item",
      "table",
      "table_row",
      "table_cell",
      "page_break",
      "form_field",
      "hard_break",
    ];
    for (const name of required) {
      expect(schema.nodes[name], `missing node: ${name}`).toBeDefined();
    }
  });

  it("heading has a level attribute defaulting to 1", () => {
    const heading = schema.nodes["heading"]!;
    expect(heading.spec.attrs?.["level"]?.default).toBe(1);
  });

  it("form_field has fieldType attribute defaulting to text", () => {
    const field = schema.nodes["form_field"]!;
    expect(field.spec.attrs?.["fieldType"]?.default).toBe("text");
  });

  it("table has columnWidths attribute defaulting to empty array", () => {
    const table = schema.nodes["table"]!;
    expect(table.spec.attrs?.["columnWidths"]?.default).toEqual([]);
  });
});

describe("schema — marks", () => {
  it("has all required mark types", () => {
    const required = [
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "font_size",
      "font_family",
      "color",
      "link",
      "track_insert",
      "track_delete",
    ];
    for (const name of required) {
      expect(schema.marks[name], `missing mark: ${name}`).toBeDefined();
    }
  });

  it("link mark is non-inclusive (typing at end does not extend it)", () => {
    expect(schema.marks["link"]!.spec.inclusive).toBe(false);
  });

  it("font_size excludes itself (only one size at a time)", () => {
    expect(schema.marks["font_size"]!.spec.excludes).toBe("font_size");
  });

  it("track_insert has author and date attributes", () => {
    const mark = schema.marks["track_insert"]!;
    expect(mark.spec.attrs?.["author"]).toBeDefined();
    expect(mark.spec.attrs?.["date"]).toBeDefined();
  });
});

describe("schema — document construction", () => {
  it("can create a valid document with a paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Hello, world.")]),
    ]);
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(doc.firstChild?.textContent).toBe("Hello, world.");
  });

  it("can create a heading with a level", () => {
    const heading = schema.node("heading", { level: 2 }, [
      schema.text("Section 1"),
    ]);
    expect(heading.attrs["level"]).toBe(2);
    expect(heading.textContent).toBe("Section 1");
  });

  it("can apply bold mark to text", () => {
    const boldText = schema.text("bold text", [schema.marks["bold"]!.create()]);
    expect(boldText.marks[0]?.type.name).toBe("bold");
  });

  it("can apply track_insert mark with author and date", () => {
    const inserted = schema.text("new clause", [
      schema.marks["track_insert"]!.create({
        author: "Alice",
        date: "2026-03-19T00:00:00Z",
      }),
    ]);
    const mark = inserted.marks[0]!;
    expect(mark.type.name).toBe("track_insert");
    expect(mark.attrs["author"]).toBe("Alice");
  });

  it("serialises to JSON and back without data loss", () => {
    const doc = schema.node("doc", null, [
      schema.node("heading", { level: 1 }, [schema.text("Contract")]),
      schema.node("paragraph", null, [
        schema.text("This agreement is between "),
        schema.text("Party A", [schema.marks["bold"]!.create()]),
        schema.text(" and Party B."),
      ]),
    ]);

    const json = doc.toJSON();
    const restored = schema.nodeFromJSON(json);
    expect(restored.toJSON()).toEqual(json);
  });
});
