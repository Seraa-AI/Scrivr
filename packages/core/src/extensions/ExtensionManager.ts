import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import type { Plugin, Command } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Extension } from "./Extension";
import type { MarkDecorator, ResolvedExtension } from "./types";

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
    const mergedKeymap: Record<string, Command> = {};

    for (const ext of this.resolved) {
      plugins.push(...ext.plugins);
      Object.assign(mergedKeymap, ext.keymap);
    }

    if (Object.keys(mergedKeymap).length > 0) {
      plugins.push(keymap(mergedKeymap));
    }

    return plugins;
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
   * Map of node type name → BlockStrategy.
   * Consumed by BlockRegistry (Phase 3 work).
   *
   * Each extension that contributes a block node type should also provide
   * addLayoutHandler(). Extensions that only contribute marks return null.
   */
  buildLayoutHandlers(): Map<string, NonNullable<ResolvedExtension["layoutHandler"]>> {
    const handlers = new Map<string, NonNullable<ResolvedExtension["layoutHandler"]>>();
    for (const ext of this.resolved) {
      if (ext.layoutHandler) {
        handlers.set(ext.name, ext.layoutHandler);
      }
    }
    return handlers;
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
}
