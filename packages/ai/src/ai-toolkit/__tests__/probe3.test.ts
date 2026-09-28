import { describe, it } from "vitest";
import { SemanticEditSchema, StructuralSemanticEditSchema } from "../../schema/edit";
import { z } from "zod";

const cases: unknown[] = [
  { kind: "structural", op: "deleteTableRow", nodeId: "r1" },
  { kind: "structural", op: "deleteTableRow", anchorNodeId: "r1" },
  { kind: "structural", op: "deleteBlock", nodeId: "p1" },
  { kind: "structural", op: "insertBlock", position: "after", anchorNodeId: "p1", block: { type: "paragraph" } },
  { kind: "structural", op: "notARealOp", nodeId: "p1" },
  { kind: "richText", nodeId: "p1", spans: [] },
];

describe("zod probe", () => {
  it("zod version", () => console.log("zod", z.string().constructor.name, (z as any).version ?? "?"));
  it("via SemanticEditSchema", () => {
    for (const c of cases) {
      const r = SemanticEditSchema.safeParse(c);
      console.log("OUTER", JSON.stringify(c), "=>", r.success ? "OK " + JSON.stringify(r.data) : "ERR " + r.error.issues.map((i) => i.path.join(".") + ":" + i.code).join("|"));
    }
  });
  it("via StructuralSemanticEditSchema", () => {
    for (const c of cases) {
      const r = StructuralSemanticEditSchema.safeParse(c);
      console.log("INNER", JSON.stringify(c), "=>", r.success ? "OK " + JSON.stringify(r.data) : "ERR " + r.error.issues.map((i) => i.path.join(".") + ":" + i.code).join("|"));
    }
  });
});
