import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { inputRules } from "prosemirror-inputrules";
import type { Plugin, Command } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Extension } from "./Extension";
import type { MarkDecorator, ResolvedExtension, FontModifier, ToolbarItemSpec, InputHandler, MarkdownBlockRule } from "./types";
import { BlockRegistry } from "../layout/BlockRegistry";
import type { FontConfig } from "../layout/FontConfig";

/**
 * ExtensionManager — orchestrates all registered extensions.
 *
 * Responsibilities:
 *  1. Build a single merged ProseMirror Schema from all extension node/mark contributions
 *  2. Collect ProseMirror plugins (including merged keymap)
 *  3. Build the BlockRegistry from layout handlers
 *  4. Build the mark decorator map for the renderer
 *  5. Expose the merged command map
 *
 * Resolution order matters — later extensions win on key conflicts.
 * StarterKit should always be first so built-in defaults can be overridden.
 */
export class ExtensionManager {
  readonly schema: Schema;
  private resolved: ResolvedExtension[];

  constructor(extensions: Extension[]) {
    // Phase 1: build schema (no schema context yet — addNodes/addMarks only)
    this.schema = this.buildSchema(extensions);

    // Phase 2+: resolve everything else with the built schema in context
    this.resolved = extensions.map((ext) => ext.resolve(this.schema));
  }

  // ── Schema ─────────────────────────────────────────────────────────────────

  private buildSchema(extensions: Extension[]): Schema {
    // doc and text are always required by ProseMirror — provide them as baseline
    const nodes: Record<string, object> = {
      doc: { content: "block+" },
      text: { group: "inline" },
    };
    const marks: Record<string, object> = {};

    for (const ext of extensions) {
      const partial = ext.resolve(); // no schema — Phase 1 only
      Object.assign(nodes, partial.nodes);
      Object.assign(marks, partial.marks);
    }

    return new Schema({ nodes, marks });
  }

  // ── Plugins ────────────────────────────────────────────────────────────────

  /**
   * Create an EditorState using this manager's schema and plugins.
   * Optionally seed with an existing doc (e.g. when restoring from JSON).
   *
   * Consumers use this instead of importing EditorState from prosemirror-state.
   */
  createState(doc?: ProseMirrorNode): EditorState {
    return EditorState.create({
      schema: this.schema,
      plugins: this.buildPlugins(),
      ...(doc ? { doc } : {}),
    });
  }

  /**
   * Returns all ProseMirror plugins to pass to EditorState.create().
   * Includes a merged keymap plugin.
   */
  buildPlugins(): Plugin[] {
    const plugins: Plugin[] = [];
    for (const ext of this.resolved) {
      plugins.push(...ext.plugins);
    }
    const km = this.buildKeymap();
    if (Object.keys(km).length > 0) {
      plugins.push(keymap(km));
    }
    const rules = this.buildInputRules();
    if (rules.length > 0) {
      plugins.push(inputRules({ rules }));
    }
    return plugins;
  }

  /**
   * Returns the merged keymap from all extensions.
   * Used by the Editor to dispatch key events without a ProseMirror EditorView.
   */
  buildKeymap(): Record<string, Command> {
    const merged: Record<string, Command> = {};
    for (const ext of this.resolved) {
      Object.assign(merged, ext.keymap);
    }
    return merged;
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  /**
   * Merged command map from all extensions.
   * Exposed on the Editor as editor.commands.
   */
  buildCommands(): Record<string, (...args: unknown[]) => Command> {
    const commands: Record<string, (...args: unknown[]) => Command> = {};
    for (const ext of this.resolved) {
      Object.assign(commands, ext.commands);
    }
    return commands;
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  /**
   * Builds a BlockRegistry from all extensions that implement addLayoutHandlers().
   * PageRenderer uses this to dispatch rendering to the correct strategy per block type.
   */
  buildBlockRegistry(): BlockRegistry {
    const registry = new BlockRegistry();
    for (const ext of this.resolved) {
      for (const [nodeTypeName, strategy] of Object.entries(ext.layoutHandlers)) {
        registry.register(nodeTypeName, strategy);
      }
    }
    return registry;
  }

  /**
   * Merged block styles from all extensions.
   * Pass as fontConfig to layoutDocument so heading/paragraph fonts come from extensions.
   */
  buildBlockStyles(): FontConfig {
    const merged: FontConfig = {};
    for (const ext of this.resolved) {
      Object.assign(merged, ext.blockStyles);
    }
    return merged;
  }

  // ── Mark decorators ────────────────────────────────────────────────────────

  /**
   * Map of mark type name → MarkDecorator.
   * Consumed by the renderer to run pre/post paint hooks per mark.
   */
  buildMarkDecorators(): Map<string, MarkDecorator> {
    const decorators = new Map<string, MarkDecorator>();
    for (const ext of this.resolved) {
      for (const [markName, decorator] of ext.markDecorators) {
        decorators.set(markName, decorator);
      }
    }
    return decorators;
  }

  /**
   * Returns a map of mark name → FontModifier from all extensions.
   * Pass this to layoutDocument so resolveFont uses extension-declared modifiers.
   */
  buildFontModifiers(): Map<string, FontModifier> {
    const merged = new Map<string, FontModifier>();
    for (const ext of this.resolved) {
      for (const [name, modifier] of ext.fontModifiers) {
        merged.set(name, modifier);
      }
    }
    return merged;
  }

  /**
   * Returns all toolbar item specs from all extensions, in registration order.
   */
  buildToolbarItems(): ToolbarItemSpec[] {
    return this.resolved.flatMap((ext) => ext.toolbarItems);
  }

  /**
   * Returns the merged input handler map from all extensions.
   * Later extensions override earlier ones on key conflicts.
   */
  buildInputHandlers(): Record<string, InputHandler> {
    const merged: Record<string, InputHandler> = {};
    for (const ext of this.resolved) {
      Object.assign(merged, ext.inputHandlers);
    }
    return merged;
  }

  /**
   * All markdown block rules from all extensions, in registration order.
   * Passed to PasteTransformer so custom nodes are recognised on paste.
   */
  buildMarkdownRules(): MarkdownBlockRule[] {
    return this.resolved.flatMap((ext) => ext.markdownRules);
  }

  /**
   * All input rules from all extensions, in registration order.
   * Consumed by buildPlugins() — exposed here for testing.
   */
  buildInputRules() {
    return this.resolved.flatMap((ext) => ext.inputRules);
  }
}
