/**
 * Collaboration's Yjs and Hocuspocus packages are optional peers, so only the
 * collaboration entry may load them: an app without collaboration imports
 * every other plugin without installing them.
 */
import { describe, expect, it, vi } from "vitest";

// A throwing factory stands in for a peer that is not installed.
vi.mock("yjs", () => { throw new Error("yjs is not installed"); });
vi.mock("y-prosemirror", () => { throw new Error("y-prosemirror is not installed"); });
vi.mock("@hocuspocus/provider", () => { throw new Error("@hocuspocus/provider is not installed"); });

describe("plugin entry points without the collaboration peers", () => {
  it.each([
    ["the root", () => import("../index")],
    ["track-changes", () => import("../track-changes")],
    ["citation-highlight", () => import("../citation-highlight")],
    ["header-footer", () => import("../header-footer")],
    ["sealed-viewer", () => import("../sealed-viewer")],
  ])("%s imports", async (_name, load) => {
    await expect(load()).resolves.toBeDefined();
  });

  it("collaboration needs them", async () => {
    await expect(import("../collaboration")).rejects.toThrow();
  });
});
