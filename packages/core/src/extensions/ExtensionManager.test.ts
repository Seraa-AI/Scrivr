import { describe, it, expect } from "vitest";
import { ExtensionManager } from "./ExtensionManager";
import { StarterKit } from "./StarterKit";
import { Bold } from "./built-in/Bold";
import { Italic } from "./built-in/Italic";
import { Paragraph } from "./built-in/Paragraph";
import { Document } from "./built-in/Document";
import { History } from "./built-in/History";
import { Highlight } from "./built-in/Highlight";
import { Color } from "./built-in/Color";
import { FontSize } from "./built-in/FontSize";
import { Underline } from "./built-in/Underline";

describe("ExtensionManager", () => {
  describe("schema", () => {
    it("builds a schema with nodes and marks from extensions", () => {
      const manager = new ExtensionManager([StarterKit]);
      expect(manager.schema.nodes["paragraph"]).toBeDefined();
      expect(manager.schema.nodes["heading"]).toBeDefined();
      expect(manager.schema.marks["bold"]).toBeDefined();
      expect(manager.schema.marks["italic"]).toBeDefined();
    });

    it("always includes doc and text nodes", () => {
      const manager = new ExtensionManager([StarterKit]);
      expect(manager.schema.nodes["doc"]).toBeDefined();
      expect(manager.schema.nodes["text"]).toBeDefined();
    });

    it("reflects only the extensions provided", () => {
      const manager = new ExtensionManager([StarterKit.configure({ bold: false, italic: false })]);
      expect(manager.schema.marks["bold"]).toBeUndefined();
      expect(manager.schema.marks["italic"]).toBeUndefined();
    });
  });

  describe("buildPlugins", () => {
    it("returns an array of ProseMirror plugins", () => {
      const manager = new ExtensionManager([StarterKit]);
      const plugins = manager.buildPlugins();
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins.length).toBeGreaterThan(0);
    });

    it("includes the keymap plugin when extensions define keymaps", () => {
      const manager = new ExtensionManager([StarterKit]);
      const plugins = manager.buildPlugins();
      // history + keymap at minimum
      expect(plugins.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("buildKeymap", () => {
    it("returns a merged keymap object", () => {
      const manager = new ExtensionManager([StarterKit]);
      const km = manager.buildKeymap();
      expect(typeof km).toBe("object");
      expect(km["Mod-b"]).toBeDefined(); // Bold shortcut
      expect(km["Mod-i"]).toBeDefined(); // Italic shortcut
    });

    it("includes Enter from Paragraph extension", () => {
      const manager = new ExtensionManager([StarterKit]);
      const km = manager.buildKeymap();
      expect(km["Enter"]).toBeDefined();
    });
  });

  describe("buildCommands", () => {
    it("returns commands from all extensions", () => {
      const manager = new ExtensionManager([StarterKit]);
      const cmds = manager.buildCommands();
      expect(typeof cmds["toggleBold"]).toBe("function");
      expect(typeof cmds["toggleItalic"]).toBe("function");
      expect(typeof cmds["undo"]).toBe("function");
    });

    it("later extensions override earlier ones on name collision", () => {
      const ext1 = Bold;
      const ext2 = Bold; // same command names — second registration wins
      const manager = new ExtensionManager([Document, Paragraph, ext1, ext2]);
      const cmds = manager.buildCommands();
      expect(typeof cmds["toggleBold"]).toBe("function");
    });
  });

  describe("buildFontModifiers", () => {
    it("returns font modifiers from extensions that declare them", () => {
      const manager = new ExtensionManager([StarterKit]);
      const mods = manager.buildFontModifiers();
      expect(mods instanceof Map).toBe(true);
      expect(mods.has("bold")).toBe(true);
      expect(mods.has("italic")).toBe(true);
      expect(mods.has("font_size")).toBe(true);
    });

    it("returns an empty map when no extensions declare font modifiers", () => {
      const manager = new ExtensionManager([Document, Paragraph]);
      const mods = manager.buildFontModifiers();
      expect(mods.size).toBe(0);
    });
  });

  describe("buildMarkDecorators", () => {
    it("returns decorators from extensions that declare them", () => {
      const manager = new ExtensionManager([StarterKit]);
      const decs = manager.buildMarkDecorators();
      expect(decs instanceof Map).toBe(true);
      expect(decs.has("underline")).toBe(true);
      expect(decs.has("strikethrough")).toBe(true);
      expect(decs.has("highlight")).toBe(true);
      expect(decs.has("color")).toBe(true);
    });

    it("returns an empty map when no extensions declare mark decorators", () => {
      const manager = new ExtensionManager([Document, Paragraph, Bold]);
      const decs = manager.buildMarkDecorators();
      expect(decs.size).toBe(0);
    });
  });

  describe("buildToolbarItems", () => {
    it("returns toolbar items from all extensions in registration order", () => {
      const manager = new ExtensionManager([StarterKit]);
      const items = manager.buildToolbarItems();
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
      const labels = items.map((i) => i.label);
      expect(labels).toContain("B"); // Bold
      expect(labels).toContain("I"); // Italic
    });

    it("returns an empty array when no extensions declare toolbar items", () => {
      const manager = new ExtensionManager([Document, Paragraph, History]);
      const items = manager.buildToolbarItems();
      expect(items.length).toBe(0);
    });
  });

  describe("buildInputHandlers", () => {
    it("returns input handlers from all extensions", () => {
      const manager = new ExtensionManager([StarterKit]);
      const handlers = manager.buildInputHandlers();
      expect(typeof handlers).toBe("object");
      // Arrow key handlers from BaseEditing
      expect(typeof handlers["ArrowLeft"]).toBe("function");
      expect(typeof handlers["ArrowRight"]).toBe("function");
    });

    it("returns an empty object when no extensions declare input handlers", () => {
      const manager = new ExtensionManager([Document, Paragraph, Bold]);
      const handlers = manager.buildInputHandlers();
      expect(Object.keys(handlers).length).toBe(0);
    });
  });

  describe("createState", () => {
    it("creates a valid ProseMirror EditorState", () => {
      const manager = new ExtensionManager([StarterKit]);
      const state = manager.createState();
      expect(state.doc.type.name).toBe("doc");
      expect(state.selection.empty).toBe(true);
    });
  });

  describe("Color extension", () => {
    it("contributes color mark, setColor command, and toolbar items", () => {
      const manager = new ExtensionManager([StarterKit]);
      expect(manager.schema.marks["color"]).toBeDefined();
      expect(manager.buildCommands()["setColor"]).toBeDefined();
      const swatches = manager.buildToolbarItems().filter((i) => i.command === "setColor");
      expect(swatches.length).toBe(6); // default 6 colors
    });
  });

  describe("FontSize extension", () => {
    it("contributes font_size mark, setFontSize command, font modifier, and toolbar items", () => {
      const manager = new ExtensionManager([StarterKit]);
      expect(manager.schema.marks["font_size"]).toBeDefined();
      expect(manager.buildCommands()["setFontSize"]).toBeDefined();
      expect(manager.buildFontModifiers().has("font_size")).toBe(true);
      const sizeButtons = manager.buildToolbarItems().filter((i) => i.command === "setFontSize");
      expect(sizeButtons.length).toBe(7); // default 7 sizes
    });
  });

  describe("Underline extension", () => {
    it("contributes underline mark decorator", () => {
      const manager = new ExtensionManager([StarterKit]);
      const decs = manager.buildMarkDecorators();
      const underlineDec = decs.get("underline");
      expect(underlineDec).toBeDefined();
      expect(typeof underlineDec!.decoratePost).toBe("function");
    });
  });

  describe("Highlight extension", () => {
    it("contributes highlight mark decorator with decoratePre", () => {
      const manager = new ExtensionManager([StarterKit]);
      const decs = manager.buildMarkDecorators();
      const highlightDec = decs.get("highlight");
      expect(highlightDec).toBeDefined();
      expect(typeof highlightDec!.decoratePre).toBe("function");
    });
  });

  describe("buildInlineRegistry", () => {
    it("returns an InlineRegistry with image strategy registered via StarterKit", () => {
      // THE REGRESSION: StarterKit was collecting layoutHandlers (now empty on Image)
      // instead of inlineHandlers — image strategy was never registered, so images
      // rendered as blank cursors. This test locks that wiring in.
      const manager = new ExtensionManager([StarterKit]);
      const registry = manager.buildInlineRegistry();
      expect(registry.has("image")).toBe(true);
    });

    it("image strategy has a callable render function", () => {
      const manager = new ExtensionManager([StarterKit]);
      const registry = manager.buildInlineRegistry();
      const strategy = registry.get("image");
      expect(typeof strategy?.render).toBe("function");
    });

    it("returns empty registry when no extensions declare inline handlers", () => {
      const manager = new ExtensionManager([Document, Paragraph, Bold]);
      const registry = manager.buildInlineRegistry();
      expect(registry.has("image")).toBe(false);
    });

    it("StarterKit.configure({ image: false }) excludes the image strategy", () => {
      const manager = new ExtensionManager([StarterKit.configure({ image: false })]);
      const registry = manager.buildInlineRegistry();
      expect(registry.has("image")).toBe(false);
    });
  });
});
