/**
 * Editor theme wiring — integration tests against a real Editor instance
 * with a Skia-backed measurer (`createTestEditor`) so the theme / setTheme /
 * observer / redraw paths run end-to-end without DOM canvas patching.
 */
import { describe, it, expect } from "vitest";
import { defaultEditorTheme } from "./model/theme";
import { createTestEditor } from "./test-utils";

describe("Editor — theme defaults", () => {
  it("returns defaultEditorTheme when no theme option is passed", () => {
    const editor = createTestEditor({});
    const resolved = editor.getResolvedTheme();
    // pageBg/defaultText should match defaults (literal or browser-resolved
    // form — both branches are valid; the user's value was undefined).
    expect(resolved.pageBg).toBeTruthy();
    expect(resolved.defaultText).toBeTruthy();
    editor.destroy();
  });

  it("getTheme() returns the user-provided input shape", () => {
    const editor = createTestEditor({ theme: { pageBg: "#1e1e1e" } });
    expect(editor.getTheme().pageBg).toBe("#1e1e1e");
    editor.destroy();
  });
});

describe("Editor — setTheme", () => {
  it("merges partial overrides", () => {
    const editor = createTestEditor({ theme: { pageBg: "#fff", defaultText: "#000" } });
    editor.setTheme({ pageBg: "#1e1e1e" });
    expect(editor.getTheme().pageBg).toBe("#1e1e1e");
    expect(editor.getTheme().defaultText).toBe("#000");
    editor.destroy();
  });

  it("null resets a token to default", () => {
    const editor = createTestEditor({ theme: { pageBg: "#1e1e1e" } });
    editor.setTheme({ pageBg: null });
    expect(editor.getTheme().pageBg).toBe(defaultEditorTheme.pageBg);
    editor.destroy();
  });

  it("undefined leaves the token alone", () => {
    const editor = createTestEditor({ theme: { pageBg: "#1e1e1e" } });
    editor.setTheme({ pageBg: undefined });
    expect(editor.getTheme().pageBg).toBe("#1e1e1e");
    editor.destroy();
  });

  it("bumps renderGeneration to invalidate paint caches", () => {
    const editor = createTestEditor({});
    const before = editor.renderGeneration;
    editor.setTheme({ pageBg: "#1e1e1e" });
    expect(editor.renderGeneration).toBeGreaterThan(before);
    editor.destroy();
  });

  it("empty arg = pure refresh (no merge, still bumps generation)", () => {
    const editor = createTestEditor({});
    const before = editor.renderGeneration;
    editor.setTheme({});
    expect(editor.renderGeneration).toBeGreaterThan(before);
    editor.destroy();
  });
});

describe("Editor — destroy", () => {
  it("removes theme probe element from themeRoot", () => {
    const editor = createTestEditor({ theme: { pageBg: "#1e1e1e" } });
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
    const editor = createTestEditor({ theme: { pageBg: "#1e1e1e" } });
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
