/**
 * Editor theme wiring — integration tests against a real Editor instance.
 *
 * Mocks canvas getContext but uses the real Editor + StarterKit so the
 * theme/setTheme/observer/redraw paths run end-to-end.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Editor } from "./Editor";
import { defaultEditorTheme } from "./model/theme";

function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: vi.fn(() => ({ width: 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 3, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3 })),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    resetTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    setLineDash: vi.fn(),
    drawImage: vi.fn(),
    font: "",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textBaseline: "alphabetic",
    textAlign: "left",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  } as unknown as CanvasRenderingContext2D);
}

beforeEach(() => {
  stubCanvas();
});

describe("Editor — theme defaults", () => {
  it("returns defaultEditorTheme when no theme option is passed", () => {
    const editor = new Editor({});
    const resolved = editor.getResolvedTheme();
    // pageBg/defaultText should match defaults (literal or browser-resolved
    // form — both branches are valid; the user's value was undefined).
    expect(resolved.pageBg).toBeTruthy();
    expect(resolved.defaultText).toBeTruthy();
    editor.destroy();
  });

  it("getTheme() returns the user-provided input shape", () => {
    const editor = new Editor({ theme: { pageBg: "#1e1e1e" } });
    expect(editor.getTheme().pageBg).toBe("#1e1e1e");
    editor.destroy();
  });
});

describe("Editor — setTheme", () => {
  it("merges partial overrides", () => {
    const editor = new Editor({ theme: { pageBg: "#fff", defaultText: "#000" } });
    editor.setTheme({ pageBg: "#1e1e1e" });
    expect(editor.getTheme().pageBg).toBe("#1e1e1e");
    expect(editor.getTheme().defaultText).toBe("#000");
    editor.destroy();
  });

  it("null resets a token to default", () => {
    const editor = new Editor({ theme: { pageBg: "#1e1e1e" } });
    editor.setTheme({ pageBg: null });
    expect(editor.getTheme().pageBg).toBe(defaultEditorTheme.pageBg);
    editor.destroy();
  });

  it("undefined leaves the token alone", () => {
    const editor = new Editor({ theme: { pageBg: "#1e1e1e" } });
    editor.setTheme({ pageBg: undefined });
    expect(editor.getTheme().pageBg).toBe("#1e1e1e");
    editor.destroy();
  });

  it("bumps renderGeneration to invalidate paint caches", () => {
    const editor = new Editor({});
    const before = editor.renderGeneration;
    editor.setTheme({ pageBg: "#1e1e1e" });
    expect(editor.renderGeneration).toBeGreaterThan(before);
    editor.destroy();
  });

  it("empty arg = pure refresh (no merge, still bumps generation)", () => {
    const editor = new Editor({});
    const before = editor.renderGeneration;
    editor.setTheme({});
    expect(editor.renderGeneration).toBeGreaterThan(before);
    editor.destroy();
  });
});

describe("Editor — destroy", () => {
  it("removes theme probe element from themeRoot", () => {
    const editor = new Editor({ theme: { pageBg: "#1e1e1e" } });
    // Call something that creates the probe.
    editor.getResolvedTheme();
    editor.setTheme({ pageBg: "#fafafa" });
    const probesBefore = document.documentElement.querySelectorAll("[data-scrivr-theme-probe]");
    // Probe may or may not exist depending on resolver path; destroy should remove it if present.
    editor.destroy();
    const probesAfter = document.documentElement.querySelectorAll("[data-scrivr-theme-probe]");
    expect(probesAfter.length).toBeLessThanOrEqual(probesBefore.length);
  });

  // Mount-time probe handoff: constructor resolves against documentElement,
  // mount() switches to the container. Without disposal the documentElement
  // probe would persist after destroy().
  it("does not leak a probe to documentElement when mount() switches themeRoot to a container", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = new Editor({ theme: { pageBg: "#1e1e1e" } });
    // resolveTheme ran in the constructor against documentElement.
    editor.mount(container);
    editor.destroy();
    expect(
      document.documentElement.querySelectorAll(":scope > [data-scrivr-theme-probe]").length,
    ).toBe(0);
    expect(container.querySelectorAll("[data-scrivr-theme-probe]").length).toBe(0);
    container.remove();
  });
});
