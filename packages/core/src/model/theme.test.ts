import { describe, it, expect, afterEach } from "vitest";
import {
  defaultEditorTheme,
  defaultPdfTheme,
  mergeEditorTheme,
  themeContainsCssVars,
  type EditorTheme,
} from "./theme";
import { resolveTheme, resolveThemeColor, disposeProbe } from "./resolveTheme";

describe("theme — defaults", () => {
  it("defaultEditorTheme has every documented token", () => {
    const required = [
      "pageBg",
      "pageShadow",
      "defaultText",
      "link",
      "cursor",
      "selectionFill",
      "imagePlaceholderBg",
      "imagePlaceholderBorder",
      "imagePlaceholderText",
      "listMarker",
      "hrColor",
      "resizeHandle",
    ];
    for (const key of required) {
      expect(defaultEditorTheme).toHaveProperty(key);
      expect(typeof defaultEditorTheme[key as keyof typeof defaultEditorTheme]).toBe("string");
    }
  });

  it("defaultPdfTheme covers the same tokens", () => {
    for (const key of Object.keys(defaultEditorTheme)) {
      expect(defaultPdfTheme).toHaveProperty(key);
    }
  });

  it("defaultPdfTheme is print-ready (white bg, black text)", () => {
    expect(defaultPdfTheme.pageBg).toBe("#ffffff");
    expect(defaultPdfTheme.defaultText).toBe("#000000");
  });

  it("defaults are frozen", () => {
    expect(() => {
      // @ts-expect-error testing runtime immutability
      defaultEditorTheme.pageBg = "red";
    }).toThrow();
  });
});

describe("mergeEditorTheme", () => {
  it("partial overrides merge over base", () => {
    const base: EditorTheme = { pageBg: "#fff", defaultText: "#000" };
    const merged = mergeEditorTheme(base, { pageBg: "#1e1e1e" });
    expect(merged.pageBg).toBe("#1e1e1e");
    expect(merged.defaultText).toBe("#000");
  });

  it("undefined leaves base untouched", () => {
    const base: EditorTheme = { pageBg: "#fff" };
    const merged = mergeEditorTheme(base, { pageBg: undefined });
    expect(merged.pageBg).toBe("#fff");
  });

  it("null resets a token to its default", () => {
    const base: EditorTheme = { pageBg: "#1e1e1e" };
    const merged = mergeEditorTheme(base, { pageBg: null });
    expect(merged.pageBg).toBe(defaultEditorTheme.pageBg);
  });

  it("empty merge is a no-op", () => {
    const base: EditorTheme = { pageBg: "#fff" };
    const merged = mergeEditorTheme(base, {});
    expect(merged).toEqual(base);
  });
});

describe("themeContainsCssVars", () => {
  it("returns true when any value uses var(", () => {
    expect(themeContainsCssVars({ pageBg: "var(--bg)" })).toBe(true);
  });

  it("returns false for all-literal themes", () => {
    expect(themeContainsCssVars({ pageBg: "#fff", defaultText: "#000" })).toBe(false);
  });

  it("detects var() inside color-mix", () => {
    expect(themeContainsCssVars({ pageBg: "color-mix(in oklch, var(--a), white)" })).toBe(true);
  });
});

describe("resolveThemeColor — browser path", () => {
  const root = document.documentElement;

  afterEach(() => {
    disposeProbe(root);
  });

  it("returns a non-empty value for a literal hex", () => {
    const out = resolveThemeColor("#ff0000", root, "#000");
    // Happy-dom may return the literal hex or rgb(...) — either is fine,
    // we only care that the value isn't lost or replaced with the fallback.
    expect(out).not.toBe("");
    expect(out).not.toBe("#000");
  });

  it("falls back when var(--missing) and no fallback in declaration", () => {
    const out = resolveThemeColor("var(--scrivr-no-such-var)", root, "#fafafa");
    expect(out).toBe("#fafafa");
  });

  it("invalid color falls back", () => {
    const out = resolveThemeColor("not-a-color", root, "#fff");
    expect(out).toBe("#fff");
  });

  it("creates and reuses a single probe element", () => {
    resolveThemeColor("#fff", root, "#fff");
    resolveThemeColor("#000", root, "#000");
    const probes = root.querySelectorAll("[data-scrivr-theme-probe]");
    expect(probes.length).toBe(1);
  });
});

describe("resolveTheme", () => {
  const root = document.documentElement;

  afterEach(() => {
    disposeProbe(root);
  });

  it("resolves every token to a non-empty literal", () => {
    const resolved = resolveTheme({ pageBg: "#1e1e1e", defaultText: "#fff" }, root);
    expect(resolved.pageBg).not.toBe("");
    expect(resolved.defaultText).not.toBe("");
    // The fallback would have been the default — confirm we got the user's value through.
    expect(resolved.pageBg).not.toBe(defaultEditorTheme.pageBg);
  });

  it("uses defaults for unspecified tokens", () => {
    const resolved = resolveTheme({}, root);
    expect(resolved.pageBg).toBe(defaultEditorTheme.pageBg);
    expect(resolved.defaultText).toBe(defaultEditorTheme.defaultText);
  });

  it("passes pageShadow through verbatim (DOM-applied, multi-part)", () => {
    const shadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
    const resolved = resolveTheme({ pageShadow: shadow }, root);
    expect(resolved.pageShadow).toBe(shadow);
  });

  it("returns a frozen object", () => {
    const resolved = resolveTheme({ pageBg: "#fff" }, root);
    expect(() => {
      // @ts-expect-error testing runtime immutability
      resolved.pageBg = "red";
    }).toThrow();
  });
});
