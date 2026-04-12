import { describe, it, expect } from "vitest";
import { ExtensionManager } from "./ExtensionManager";
import { Extension } from "./Extension";
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

  describe("addDocAttrs", () => {
    // Helpers: minimal extensions that contribute a doc attr for testing.
    // We use fresh Extension.create calls rather than touching built-in
    // extensions so collision behavior is deterministic regardless of
    // which built-ins do or don't contribute doc attrs in the future.
    const makeDocAttrContributor = (name: string, attrName: string, defaultValue: unknown) =>
      Extension.create({
        name,
        addDocAttrs() {
          return { [attrName]: { default: defaultValue } };
        },
      });

    it("merges contributed doc attrs into the doc node spec", () => {
      const HeaderFooter = makeDocAttrContributor("headerFooter", "headerFooter", null);
      const manager = new ExtensionManager([StarterKit, HeaderFooter]);

      const docAttrs = manager.schema.nodes["doc"]!.spec.attrs;
      expect(docAttrs).toBeDefined();
      expect(docAttrs!["headerFooter"]).toBeDefined();
      // Default value flows through to instances of the doc node
      const doc = manager.schema.nodes["doc"]!.createAndFill()!;
      expect(doc.attrs.headerFooter).toBeNull();
    });

    it("accumulates contributions from multiple extensions additively", () => {
      const HeaderFooter = makeDocAttrContributor("headerFooter", "headerFooter", "hf-default");
      const Footnotes = makeDocAttrContributor("footnotes", "footnotes", []);
      const TrackChanges = makeDocAttrContributor("trackChanges", "trackChanges", { enabled: false });
      const manager = new ExtensionManager([StarterKit, HeaderFooter, Footnotes, TrackChanges]);

      const doc = manager.schema.nodes["doc"]!.createAndFill()!;
      expect(doc.attrs.headerFooter).toBe("hf-default");
      expect(doc.attrs.footnotes).toEqual([]);
      expect(doc.attrs.trackChanges).toEqual({ enabled: false });
    });

    it("throws on collision when two extensions contribute the same attr name", () => {
      const A = makeDocAttrContributor("extensionA", "config", "value-from-A");
      const B = makeDocAttrContributor("extensionB", "config", "value-from-B");

      expect(() => new ExtensionManager([StarterKit, A, B])).toThrow(
        /Doc attribute "config" is contributed by both "extensionA" and "extensionB"/,
      );
    });

    it("collision error mentions both owner names so the developer knows who to blame", () => {
      const A = makeDocAttrContributor("headerFooter", "metadata", null);
      const B = makeDocAttrContributor("pageSettings", "metadata", null);

      try {
        new ExtensionManager([A, B]);
        expect.fail("expected ExtensionManager to throw on collision");
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).toMatch(/"headerFooter"/);
        expect(msg).toMatch(/"pageSettings"/);
        // The error should also suggest namespacing as a fix, to guide
        // the developer away from the "what do I do now" dead end.
        expect(msg).toMatch(/[Rr]ename/);
      }
    });

    it("no collision when extensions contribute different attr names", () => {
      const HeaderFooter = makeDocAttrContributor("headerFooter", "headerFooter", null);
      const Footnotes = makeDocAttrContributor("footnotes", "footnotes", []);
      // Should not throw — different attr names, no collision
      expect(() => new ExtensionManager([StarterKit, HeaderFooter, Footnotes])).not.toThrow();
    });

    it("an extension with no addDocAttrs contributes nothing", () => {
      // Control case: existing extensions (Bold, Italic, etc.) don't contribute
      // doc attrs. The manager should build a schema without any attrs on the
      // doc node (or only whatever attrs the extensions happen to contribute).
      const manager = new ExtensionManager([Document, Paragraph, Bold]);
      const docAttrs = manager.schema.nodes["doc"]!.spec.attrs;
      // Either undefined or an empty object — both are acceptable "nothing contributed"
      if (docAttrs !== undefined) {
        expect(Object.keys(docAttrs)).toHaveLength(0);
      }
    });

    it("contributed attrs participate in doc node creation with defaults", () => {
      const WithDefault = makeDocAttrContributor("theme", "theme", "light");
      const manager = new ExtensionManager([StarterKit, WithDefault]);

      // Creating a doc with no explicit attrs should fall through to the default
      const doc = manager.schema.nodes["doc"]!.createAndFill()!;
      expect(doc.attrs.theme).toBe("light");

      // Explicitly passing attrs should override the default
      const explicitDoc = manager.schema.nodes["doc"]!.create(
        { theme: "dark" },
        // Need content that matches "block+" — an empty paragraph works
        [manager.schema.nodes["paragraph"]!.create()],
      );
      expect(explicitDoc.attrs.theme).toBe("dark");
    });

    it("collision detection fires even when both extensions come through StarterKit-adjacent chains", () => {
      // Simulate two separate Extension.create calls producing the same
      // attr name. This catches the case where two extensions authored
      // independently by different teams happen to collide, not just
      // copy-paste mistakes.
      const A = Extension.create({
        name: "pluginA",
        addDocAttrs() { return { config: { default: null } }; },
      });
      const B = Extension.create({
        name: "pluginB",
        addDocAttrs() { return { config: { default: {} } }; }, // different default — still a collision
      });

      expect(() => new ExtensionManager([A, B])).toThrow(/collision|[cC]ontributed by both/);
    });

    it("declared attrs are writable via tr.setDocAttribute", () => {
      // End-to-end: the extension lane declares the attr, and ProseMirror's
      // built-in DocAttrStep (routed through Transaction.setDocAttribute)
      // successfully writes it. This is the pattern extensions should use.
      const Headered = makeDocAttrContributor("headered", "headerFooter", null);
      const manager = new ExtensionManager([StarterKit, Headered]);
      const state = manager.createState();

      const newConfig = { title: "Chapter 1", pageNumber: true };
      const tr = state.tr.setDocAttribute("headerFooter", newConfig);
      const nextState = state.apply(tr);

      expect(nextState.doc.attrs.headerFooter).toEqual(newConfig);

      // Undo should restore the previous value (null default).
      const undoTr = nextState.tr.step(tr.steps[0]!.invert(tr.docs[0]!));
      const undoneState = nextState.apply(undoTr);
      expect(undoneState.doc.attrs.headerFooter).toBeNull();
    });
  });
});
