import { describe, it, expect } from "vitest";
import { resolveSlot } from "../resolveSlot";
import type { HeaderFooterPolicy, HeaderFooterDefinition } from "../types";

const makeDef = (text = "test"): HeaderFooterDefinition => ({
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});

const basePolicy: HeaderFooterPolicy = {
  enabled: true,
  differentFirstPage: false,
  differentOddEven: false,
  defaultHeader: makeDef("default-header"),
  defaultFooter: makeDef("default-footer"),
};

describe("resolveSlot", () => {
  it("returns null for null policy", () => {
    expect(resolveSlot(null, { pageNumber: 1 }, "header")).toBeNull();
  });

  it("returns null when disabled", () => {
    expect(resolveSlot({ ...basePolicy, enabled: false }, { pageNumber: 1 }, "header")).toBeNull();
  });

  it("returns default header for any page when differentFirstPage is false", () => {
    expect(resolveSlot(basePolicy, { pageNumber: 1 }, "header")).toBe(basePolicy.defaultHeader);
    expect(resolveSlot(basePolicy, { pageNumber: 5 }, "header")).toBe(basePolicy.defaultHeader);
  });

  it("returns default footer for any page when differentFirstPage is false", () => {
    expect(resolveSlot(basePolicy, { pageNumber: 1 }, "footer")).toBe(basePolicy.defaultFooter);
    expect(resolveSlot(basePolicy, { pageNumber: 3 }, "footer")).toBe(basePolicy.defaultFooter);
  });

  it("returns first-page header for page 1 when differentFirstPage is true", () => {
    const policy: HeaderFooterPolicy = {
      ...basePolicy,
      differentFirstPage: true,
      firstPageHeader: makeDef("first-header"),
    };
    expect(resolveSlot(policy, { pageNumber: 1 }, "header")).toBe(policy.firstPageHeader);
  });

  it("returns default header for page 2+ when differentFirstPage is true", () => {
    const policy: HeaderFooterPolicy = {
      ...basePolicy,
      differentFirstPage: true,
      firstPageHeader: makeDef("first-header"),
    };
    expect(resolveSlot(policy, { pageNumber: 2 }, "header")).toBe(policy.defaultHeader);
    expect(resolveSlot(policy, { pageNumber: 10 }, "header")).toBe(policy.defaultHeader);
  });

  it("returns null when first-page slot is undefined and differentFirstPage is true", () => {
    const policy: HeaderFooterPolicy = {
      ...basePolicy,
      differentFirstPage: true,
      // firstPageHeader intentionally omitted
    };
    expect(resolveSlot(policy, { pageNumber: 1 }, "header")).toBeNull();
  });

  it("returns null when default slot is undefined", () => {
    const policy: HeaderFooterPolicy = {
      enabled: true,
      differentFirstPage: false,
      differentOddEven: false,
      // no defaultHeader
    };
    expect(resolveSlot(policy, { pageNumber: 1 }, "header")).toBeNull();
  });

  it("returns first-page footer for page 1 when differentFirstPage is true", () => {
    const policy: HeaderFooterPolicy = {
      ...basePolicy,
      differentFirstPage: true,
      firstPageFooter: makeDef("first-footer"),
    };
    expect(resolveSlot(policy, { pageNumber: 1 }, "footer")).toBe(policy.firstPageFooter);
  });
});
