import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock runMiniPipeline to avoid canvas dependency. resolveChrome ultimately
// calls into this; the fixed return shape lets header-footer logic exercise
// without a DOM.
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

import { ServerEditor, StarterKit, type IBaseEditor } from "@scrivr/core";
import { HeaderFooter } from "../HeaderFooter";
import type { HeaderFooterPolicy, HeaderFooterDefinition } from "../types";

function makeDef(text = "test"): HeaderFooterDefinition {
  return {
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  };
}

function createEditor() {
  return new ServerEditor({
    extensions: [StarterKit, HeaderFooter],
  });
}

/**
 * Pulls the headerFooter attr off the doc as a strongly-typed policy. Throws
 * if the attr is missing or the wrong shape — every test that calls this is
 * asserting "I expect a policy here," so a noisy failure is the right signal.
 */
function readPolicy(editor: IBaseEditor): HeaderFooterPolicy {
  const raw = editor.getState().doc.attrs["headerFooter"];
  if (raw === null || typeof raw !== "object") {
    throw new Error(`expected headerFooter policy, got ${String(raw)}`);
  }
  if (!("enabled" in raw)) {
    throw new Error("headerFooter attr present but missing `enabled` field");
  }
  return raw as HeaderFooterPolicy;
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

      expect(readPolicy(editor)).toEqual(policy);
    });

    it("updateHeaderFooter merges partial into existing policy", () => {
      const editor = createEditor();
      const initial: HeaderFooterPolicy = {
        enabled: true,
        differentFirstPage: false,
        differentOddEven: false,
        defaultHeader: makeDef("Original"),
      };

      // Set initial
      let tr = editor.getState().tr.setDocAttribute("headerFooter", initial);
      editor.applyTransaction(tr);

      const updated: HeaderFooterPolicy = {
        ...readPolicy(editor),
        differentFirstPage: true,
        firstPageHeader: makeDef("First Page"),
      };
      tr = editor.getState().tr.setDocAttribute("headerFooter", updated);
      editor.applyTransaction(tr);

      const result = readPolicy(editor);
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

  // ── Margin double-click bootstrap (Word/Docs UX) ────────────────────────────
  //
  // The chromeClick handler is installed via `onViewReady`, which by design
  // never fires on `ServerEditor` (lifecycle split — see core lifecycle.test).
  // Splicing surfaces/layout onto a ServerEditor no longer reaches the
  // handler because the hook is gated at the engine level. These tests need
  // to be re-homed against a real browser `Editor` (happy-dom env) OR the
  // chromeClick handler needs to split into an engine-phase policy bootstrap
  // and a view-phase surface activation. Skipped for now — behavior is
  // exercised end-to-end through the demo app's playground.
  // TODO(stable-api): port to real Editor + happy-dom or refactor the handler.
  describe.skip("margin double-click bootstraps policy", () => {
    // placeCursorAfterPaint uses requestAnimationFrame, which isn't defined
    // in the node test environment. Stub it as a no-op for these tests —
    // we're asserting policy/state effects, not cursor placement.
    let originalRAF: typeof globalThis.requestAnimationFrame | undefined;
    beforeEach(() => {
      originalRAF = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
    });
    afterEach(() => {
      if (originalRAF) globalThis.requestAnimationFrame = originalRAF;
    });

    interface ChromeClickPayload {
      page: number;
      x: number;
      y: number;
      band: "header" | "footer";
      clickCount: number;
    }

    /**
     * Bolt the minimum view-editor surface onto a ServerEditor so the
     * HeaderFooter extension's `onEditorReady` will install its chromeClick
     * listener. Returns the editor plus a typed `emit` helper.
     */
    function makeViewEditorLike(): {
      editor: ServerEditor;
      emit: (payload: ChromeClickPayload) => void;
    } {
      const editor = createEditor();
      const listeners = new Set<(payload: ChromeClickPayload) => void>();

      Object.assign(editor, {
        on(event: string, fn: (payload: ChromeClickPayload) => void): () => void {
          if (event !== "chromeClick") return () => {};
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        emit(_event: string, _payload: ChromeClickPayload): void {
          // intentionally unused — emit() is driven explicitly via the
          // returned helper below to keep call sites readable.
        },
        surfaces: {
          activeSurface: null,
          activate: vi.fn(),
          register: vi.fn(),
          unregister: vi.fn(),
        },
        layout: {
          pageConfig: {
            pageWidth: 816,
            pageHeight: 1056,
            margins: { top: 96, right: 96, bottom: 96, left: 96 },
          },
        },
        addOverlayRenderHandler: () => () => {},
        redraw: () => {},
        invalidateLayout: () => {},
      });

      const resolved = HeaderFooter.resolve(editor.schema);
      resolved.editorReadyCallback?.(editor);

      const emit = (payload: ChromeClickPayload) => {
        for (const fn of listeners) fn(payload);
      };
      return { editor, emit };
    }

    it("creates a policy when none exists and double-click fires in the header band", () => {
      const { editor, emit } = makeViewEditorLike();
      expect(editor.getState().doc.attrs["headerFooter"]).toBeNull();

      emit({ page: 1, x: 100, y: 40, band: "header", clickCount: 2 });

      const policy = readPolicy(editor);
      expect(policy.enabled).toBe(true);
      expect(policy.defaultHeader).toBeDefined();
    });

    it("creates a policy when none exists and double-click fires in the footer band", () => {
      const { editor, emit } = makeViewEditorLike();
      emit({ page: 1, x: 100, y: 1020, band: "footer", clickCount: 2 });

      const policy = readPolicy(editor);
      expect(policy.enabled).toBe(true);
      expect(policy.defaultFooter).toBeDefined();
    });

    it("single click in margin is a no-op (does not bootstrap)", () => {
      const { editor, emit } = makeViewEditorLike();
      emit({ page: 1, x: 100, y: 40, band: "header", clickCount: 1 });

      expect(editor.getState().doc.attrs["headerFooter"]).toBeNull();
    });

    it("force-enables a disabled policy on double-click", () => {
      const { editor, emit } = makeViewEditorLike();
      const disabled: HeaderFooterPolicy = {
        enabled: false,
        differentFirstPage: false,
        differentOddEven: false,
        defaultHeader: makeDef("Stale"),
      };
      editor.applyTransaction(
        editor.getState().tr.setDocAttribute("headerFooter", disabled),
      );

      emit({ page: 1, x: 100, y: 40, band: "header", clickCount: 2 });

      const policy = readPolicy(editor);
      expect(policy.enabled).toBe(true);
      // User's content preserved across the enable.
      expect(policy.defaultHeader).toEqual(makeDef("Stale"));
    });

    it("creates a default empty slot when the targeted first-page slot is missing", () => {
      const { editor, emit } = makeViewEditorLike();
      const seedPolicy: HeaderFooterPolicy = {
        enabled: true,
        differentFirstPage: true,
        differentOddEven: false,
        defaultHeader: makeDef("Default"),
        // firstPageHeader intentionally omitted
      };
      editor.applyTransaction(
        editor.getState().tr.setDocAttribute("headerFooter", seedPolicy),
      );

      emit({ page: 1, x: 100, y: 40, band: "header", clickCount: 2 });

      const policy = readPolicy(editor);
      expect(policy.firstPageHeader).toBeDefined();
      // Existing slot untouched.
      expect(policy.defaultHeader).toEqual(makeDef("Default"));
    });
  });
});
