import { describe, it, expect } from "vitest";
import { cx } from "./classNames";

describe("cx — positional strings (legacy callers)", () => {
  it("joins multiple class strings with a space", () => {
    expect(cx("a", "b", "c")).toBe("a b c");
  });

  it("splits each input on internal whitespace", () => {
    // Existing callers pass "scrivr-menu scrivr-link-popover" as a single
    // string — the result must read as individual tokens.
    expect(cx("a b", "c")).toBe("a b c");
  });

  it("ignores falsy values (false, null, undefined)", () => {
    expect(cx("a", false, "b", null, "c", undefined)).toBe("a b c");
  });

  it("returns undefined for no inputs / all-falsy inputs", () => {
    // React renders `className={undefined}` as if the prop was omitted.
    // The current contract returns undefined, not empty string.
    expect(cx()).toBeUndefined();
    expect(cx(false, null, undefined)).toBeUndefined();
    expect(cx("")).toBeUndefined();
  });

  it("dedups exact duplicates while preserving first-occurrence order", () => {
    expect(cx("a", "b", "a")).toBe("a b");
    expect(cx("a b a", "c b")).toBe("a b c");
  });
});

describe("cx — conditional dictionaries (new)", () => {
  it("includes keys with truthy values", () => {
    expect(cx({ open: true, closed: false })).toBe("open");
  });

  it("mixes dictionary with positional strings", () => {
    expect(cx("btn", { "btn-active": true, "btn-loading": false })).toBe("btn btn-active");
  });

  it("treats 0 / empty string / null values as falsy", () => {
    expect(cx({ a: 1, b: 0, c: "", d: null, e: "yes" })).toBe("a e");
  });

  it("splits multi-token dictionary keys", () => {
    // Less common but supported — a key with spaces means multiple classes
    // gated by the same condition.
    expect(cx({ "a b": true, c: false })).toBe("a b");
  });
});

describe("cx — nested arrays (new)", () => {
  it("flattens nested arrays of strings", () => {
    expect(cx(["a", "b"], ["c"])).toBe("a b c");
  });

  it("recurses arbitrarily deep", () => {
    expect(cx(["a", ["b", ["c", ["d"]]]])).toBe("a b c d");
  });

  it("mixes nested arrays with falsy and dicts", () => {
    const isActive = true;
    const isDisabled = false;
    expect(
      cx(
        "btn",
        [isActive && "btn-active", isDisabled && "btn-disabled"],
        { large: true },
      ),
    ).toBe("btn btn-active large");
  });
});

describe("cx — numbers (new)", () => {
  it("includes positive numbers as class tokens", () => {
    expect(cx("col-", 4)).toBe("col- 4");
  });

  it("drops zero (falsy)", () => {
    expect(cx("col-", 0, "row-", 2)).toBe("col- row- 2");
  });
});

describe("cx — Tailwind utility-class collisions are NOT auto-merged", () => {
  it("keeps both conflicting padding utilities (last-wins is CSS source order's job)", () => {
    // Documenting the limit: cx does not understand Tailwind semantics.
    // Pull in `tailwind-merge` if the project needs that.
    expect(cx("p-2", "p-4")).toBe("p-2 p-4");
  });
});
