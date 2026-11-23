/**
 * `@scrivr/plugins` and `@scrivr/ai` are optional peers: an editor-only app
 * installs neither. Only the entries built on them may load them.
 */
import { describe, expect, it, vi } from "vitest";

// A throwing factory stands in for a peer that is not installed.
vi.mock("@scrivr/plugins", () => { throw new Error("@scrivr/plugins is not installed"); });
vi.mock("@scrivr/ai", () => { throw new Error("@scrivr/ai is not installed"); });

describe("@scrivr/react's entries without the optional peers", () => {
  it("the root imports", async () => {
    await expect(import("./index")).resolves.toHaveProperty("Scrivr");
  });

  it("track-changes needs @scrivr/plugins", async () => {
    await expect(import("./track-changes")).rejects.toThrow();
  });

  it("header-footer needs @scrivr/plugins", async () => {
    await expect(import("./header-footer")).rejects.toThrow();
  });

  it("ai needs @scrivr/ai", async () => {
    await expect(import("./ai")).rejects.toThrow();
  });
});
