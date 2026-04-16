import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { inputRules } from "prosemirror-inputrules";
import type { Plugin, Command } from "prosemirror-state";
import type { Node as ProseMirrorNode, AttributeSpec } from "prosemirror-model";
import type { Extension } from "./Extension";
import type {
  MarkDecorator,
  ResolvedExtension,
  FontModifier,
  ToolbarItemSpec,
  InputHandler,
  MarkdownBlockRule,
  MarkdownParserTokenSpec,
  MarkdownSerializerRules,
  MarkdownNodeSerializer,
  MarkdownMarkSerializer,
} from "./types";
import type { IBaseEditor } from "./types";
import { BlockRegistry, InlineRegistry } from "../layout/BlockRegistry";
import type { FontConfig } from "../layout/FontConfig";
import { defaultPageConfig } from "../layout/PageLayout";
import type { PageConfig } from "../layout/PageLayout";
import type { PageChromeContribution } from "../layout/PageMetrics";
import type { SurfaceOwnerRegistration } from "../surfaces/types";

/**
 * Build a ProseMirror Schema from an array of extensions.
 *
 * This is the standalone equivalent of TipTap's `getSchema()` — it runs only
 * Phase 1 resolution (addNodes/addMarks/addDocAttrs) and returns the merged
 * schema without instantiating an Editor or ExtensionManager.
 *
 * @example
 *   import { getSchema, StarterKit } from "@inscribe/core";
 *   const schema = getSchema([StarterKit]);
 */
export function getSchema(extensions: Extension[]): Schema {
  // doc and text are always required by ProseMirror — provide them as baseline
  const nodes: Record<string, object> = {
    doc: { content: "block+" },
    text: { group: "inline" },
  };
  const marks: Record<string, object> = {};

  // Doc attr contributions — collision detection throws naming both owners.
  const docAttrs: Record<string, AttributeSpec> = {};
  const docAttrOwners: Record<string, string> = {};

  for (const ext of extensions) {
    const partial = ext.resolve(); // no schema — Phase 1 only
    // Note: addNodes({ doc: ... }) can overwrite the doc spec and bypass
    // collision detection. Use addDocAttrs() for doc-level attributes.
    Object.assign(nodes, partial.nodes);
    Object.assign(marks, partial.marks);

    // Merge docAttrs contributions with collision detection.
    for (const [attrName, spec] of Object.entries(partial.docAttrs)) {
      if (attrName in docAttrs) {
        const prevOwner = docAttrOwners[attrName]!;
        throw new Error(
          `[getSchema] Doc attribute "${attrName}" is contributed by ` +
            `both "${prevOwner}" and "${partial.name}". Doc attributes must be ` +
            `unique across all extensions. Rename one (e.g. ` +
            `"${partial.name}_${attrName}") or remove the duplicate extension.`,
        );
      }
      docAttrs[attrName] = spec;
      docAttrOwners[attrName] = partial.name;
    }
  }

  // Merge doc attrs into the doc node spec additively.
  if (Object.keys(docAttrs).length > 0) {
    const baseDoc = nodes["doc"] as Record<string, unknown>;
    nodes["doc"] = {
      ...baseDoc,
      attrs: { ...(baseDoc.attrs as object | undefined), ...docAttrs },
    };
  }

  return new Schema({ nodes, marks });
}

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
  private readonly extensions: Extension[];

  constructor(extensions: Extension[]) {
    this.extensions = extensions;

    // Phase 1: build schema (no schema context yet — addNodes/addMarks only)
    this.schema = getSchema(extensions);

    // Phase 2+: resolve everything else with the built schema in context
    this.resolved = extensions.map((ext) => ext.resolve(this.schema));
  }

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
   * Returns the first non-null initial doc contributed by any extension.
   * Used by Editor to seed EditorState.create() with a doc that matches
   * a plugin's internal mapping (e.g. initProseMirrorDoc for ySyncPlugin).
   */
  buildInitialDoc(): ProseMirrorNode | undefined {
    for (const ext of this.resolved) {
      if (ext.initialDoc) return ext.initialDoc;
    }
    return undefined;
  }

  /**
   * Returns the PageConfig from a "pagination" extension if one is present,
   * otherwise returns undefined (Editor falls back to EditorOptions.pageConfig).
   *
   * The Pagination extension's options ARE the PageConfig — no extra hook needed.
   */
  /**
   * Returns the PageConfig from the extension list.
   *
   * Resolution order:
   *   1. A standalone "pagination" extension (Pagination.configure({...}))
   *   2. StarterKit's `pagination` option (StarterKit.configure({ pagination: {...} }))
   *   3. undefined → Editor falls back to EditorOptions.pageConfig → defaultPageConfig
   */
  buildPageConfig(): PageConfig | undefined {
    const pagination = this.extensions.find((e) => e.name === "pagination");
    if (pagination) return pagination.options as PageConfig;

    const starterKit = this.extensions.find((e) => e.name === "starterKit");
    if (starterKit) {
      const { pagination: pkOpt } = starterKit.options as {
        pagination?: false | Partial<PageConfig>;
      };
      if (pkOpt !== false && pkOpt !== undefined) {
        return { ...defaultPageConfig, ...pkOpt } as PageConfig;
      }
      // pagination not explicitly set → StarterKit default includes Pagination with defaultPageConfig
      if (pkOpt === undefined) {
        return defaultPageConfig;
      }
    }

    return undefined;
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

  /**
   * Page chrome contributions (headers, footers, footnote bands, etc.) in
   * extension registration order. Passed into runChromeLoop each layout run.
   */
  getPageChromeContributions(): PageChromeContribution[] {
    const contribs: PageChromeContribution[] = [];
    for (const ext of this.resolved) {
      if (ext.pageChrome !== null) contribs.push(ext.pageChrome);
    }
    return contribs;
  }

  /**
   * Surface owner registrations keyed by `owner`. Throws if two extensions
   * claim the same owner namespace — the SurfaceRegistry needs a single
   * lifecycle mediator per owner or callbacks would collide silently.
   * Installed onto SurfaceRegistry via `_setOwnerMediator()` during Editor
   * construction.
   */
  getSurfaceOwners(): Map<string, SurfaceOwnerRegistration> {
    const map = new Map<string, SurfaceOwnerRegistration>();
    const sources = new Map<string, string>(); // owner → extension name
    for (const ext of this.resolved) {
      if (ext.surfaceOwner === null) continue;
      const { owner } = ext.surfaceOwner;
      if (map.has(owner)) {
        const prev = sources.get(owner)!;
        throw new Error(
          `[ExtensionManager] Surface owner "${owner}" is contributed by ` +
            `both "${prev}" and "${ext.name}". Owner namespaces must be ` +
            `unique across all extensions. Rename the owner in one of the ` +
            `two extensions (e.g. "${owner}2") or remove the duplicate.`,
        );
      }
      map.set(owner, ext.surfaceOwner);
      sources.set(owner, ext.name);
    }
    return map;
  }

  /**
   * Builds a BlockRegistry from all extensions that implement addLayoutHandlers().
   * PageRenderer uses this to dispatch rendering to the correct strategy per block type.
   */
  buildBlockRegistry(): BlockRegistry {
    const registry = new BlockRegistry();
    for (const ext of this.resolved) {
      for (const [nodeTypeName, strategy] of Object.entries(
        ext.layoutHandlers,
      )) {
        registry.register(nodeTypeName, strategy);
      }
    }
    return registry;
  }

  /**
   * Builds an InlineRegistry from all extensions that implement addInlineHandlers().
   * TextBlockStrategy uses this to dispatch rendering of inline object spans.
   */
  buildInlineRegistry(): InlineRegistry {
    const registry = new InlineRegistry();
    for (const ext of this.resolved) {
      for (const [nodeTypeName, strategy] of Object.entries(
        ext.inlineHandlers,
      )) {
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

  /**
   * Merged markdown parser token map from all extensions.
   * Passed to PasteTransformer to build a prosemirror-markdown MarkdownParser.
   */
  buildMarkdownParserTokens(): Record<string, MarkdownParserTokenSpec> {
    const merged: Record<string, MarkdownParserTokenSpec> = {};
    for (const ext of this.resolved) {
      Object.assign(merged, ext.markdownParserTokens);
    }
    return merged;
  }

  /**
   * Returns the onEditorReady callbacks from all extensions that define one.
   * Called by Editor at the end of construction to let extensions do runtime
   * setup (collaboration providers, overlay handlers, etc.).
   */
  buildEditorReadyCallbacks(): Array<
    (editor: IBaseEditor) => (() => void) | void
  > {
    return this.resolved
      .filter((ext) => ext.editorReadyCallback !== undefined)
      .map((ext) => ext.editorReadyCallback!);
  }

  /**
   * Merged markdown serializer rules from all extensions.
   * Used by Editor.getMarkdownSerializer() to build a MarkdownSerializer.
   */
  buildMarkdownSerializerRules(): Required<MarkdownSerializerRules> {
    const nodes: Record<string, MarkdownNodeSerializer> = {};
    const marks: Record<string, MarkdownMarkSerializer> = {};
    for (const ext of this.resolved) {
      Object.assign(nodes, ext.markdownSerializerRules.nodes ?? {});
      Object.assign(marks, ext.markdownSerializerRules.marks ?? {});
    }
    return { nodes, marks };
  }
}
