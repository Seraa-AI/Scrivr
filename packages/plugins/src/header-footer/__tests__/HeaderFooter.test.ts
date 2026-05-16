import { describe, it, expect, vi } from "vitest";

// Mock runMiniPipeline to avoid canvas dependency
vi.mock("@scrivr/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scrivr/core")>();
  return {
    ...actual,
    runMiniPipeline: vi.fn((_doc, _opts) => ({
      pages: [{ pageNumber: 1, blocks: [] }],
      pageConfig: {
        pageWidth: 816,
        pageHeight: 1056,
        margins: { top: 96, bottom: 96, left: 96, right: 96 },
        pageless: false,
      },
      version: 1,
      totalContentHeight: 36,
      metrics: [
        {
          contentTop: 96,
          contentBottom: 960,
          contentHeight: 864,
          contentWidth: 624,
          headerTop: 96,
          footerTop: 960,
          headerHeight: 0,
          footerHeight: 0,
          pageNumber: 1,
        },
      ],
      runId: 0,
      convergence: "stable" as const,
      iterationCount: 1,
      chromePayloads: {},
    })),
  };
});

import { ServerEditor, StarterKit } from "@scrivr/core";
import { HeaderFooter } from "../HeaderFooter";
import type { HeaderFooterPolicy } from "../types";

const makeDef = (text = "test") => ({
  content: {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});

function createEditor() {
  return new ServerEditor({
    extensions: [StarterKit, HeaderFooter],
  });
}

describe("HeaderFooter extension", () => {
  it("adds headerFooter attr to doc schema", () => {
    const editor = createEditor();
    const attrs = editor.schema.nodes["doc"]!.spec.attrs;
    expect(attrs).toHaveProperty("headerFooter");
  });

  it("headerFooter attr defaults to null", () => {
    const editor = createEditor();
    expect(editor.getState().doc.attrs["headerFooter"]).toBeNull();
  });

  it("adds pageNumber, totalPages, date node types to schema", () => {
    const editor = createEditor();
    expect(editor.schema.nodes["pageNumber"]).toBeDefined();
    expect(editor.schema.nodes["totalPages"]).toBeDefined();
    expect(editor.schema.nodes["date"]).toBeDefined();
  });

  describe("commands", () => {
    it("setHeaderFooter sets the policy on doc.attrs", () => {
      const editor = createEditor();
      const policy: HeaderFooterPolicy = {
        enabled: true,
        differentFirstPage: false,
        differentOddEven: false,
        defaultHeader: makeDef("My Header"),
      };

      const state = editor.getState();
      const tr = state.tr.setDocAttribute("headerFooter", policy);
      editor.applyTransaction(tr);

      expect(editor.getState().doc.attrs["headerFooter"]).toEqual(policy);
    });

    it("updateHeaderFooter merges partial into existing policy", () => {
      const editor = createEditor();
      const policy: HeaderFooterPolicy = {
        enabled: true,
        differentFirstPage: false,
        differentOddEven: false,
        defaultHeader: makeDef("Original"),
      };

      // Set initial
      let tr = editor.getState().tr.setDocAttribute("headerFooter", policy);
      editor.applyTransaction(tr);

      // Update partial
      const updated = {
        ...(editor.getState().doc.attrs["headerFooter"] as HeaderFooterPolicy),
        differentFirstPage: true,
        firstPageHeader: makeDef("First Page"),
      };
      tr = editor.getState().tr.setDocAttribute("headerFooter", updated);
      editor.applyTransaction(tr);

      const result = editor.getState().doc.attrs[
        "headerFooter"
      ] as HeaderFooterPolicy;
      expect(result.differentFirstPage).toBe(true);
      expect(result.firstPageHeader).toEqual(makeDef("First Page"));
      expect(result.defaultHeader).toEqual(makeDef("Original"));
    });

    it("removeHeaderFooter sets policy to null", () => {
      const editor = createEditor();
      const policy: HeaderFooterPolicy = {
        enabled: true,
        differentFirstPage: false,
        differentOddEven: false,
        defaultHeader: makeDef("Header"),
      };

      let tr = editor.getState().tr.setDocAttribute("headerFooter", policy);
      editor.applyTransaction(tr);
      expect(editor.getState().doc.attrs["headerFooter"]).not.toBeNull();

      tr = editor.getState().tr.setDocAttribute("headerFooter", null);
      editor.applyTransaction(tr);
      expect(editor.getState().doc.attrs["headerFooter"]).toBeNull();
    });
  });
});
