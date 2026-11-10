import { describe, expect, it } from "vitest";
// Through the package barrel, as a host validates an agent's image layout.
import { SemanticImageAttrsSchema, type SemanticImageAttrs } from "../index";

describe("an image layout an agent sends", () => {
  it("is validated against the values core names", () => {
    const attrs: SemanticImageAttrs = { wrap: "behind", align: "right" };
    expect(SemanticImageAttrsSchema.safeParse(attrs).success).toBe(true);
    expect(SemanticImageAttrsSchema.safeParse({ align: "custom" }).success).toBe(false);
  });
});
