import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { inputRules } from "prosemirror-inputrules";
import type { Plugin, Command } from "prosemirror-state";
import type { Node as ProseMirrorNode, AttributeSpec, NodeSpec, MarkSpec } from "prosemirror-model";
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
import type { IBaseEditor, IEditor } from "./types";
import { BlockRegistry, InlineRegistry } from "../layout/BlockRegistry";
import type { FontConfig } from "../layout/FontConfig";
import type { PageConfig } from "../layout/PageLayout";
import type { PageChromeContribution } from "../layout/PageMetrics";
import type { SurfaceOwnerRegistration } from "../surfaces/types";
import type { ExportContributionMap } from "./export";
import { parseMarkdownToDoc } from "../model/parseMarkdown";

interface Phase1SchemaContributions {
  nodes: Record<string, NodeSpec>;
  marks: Record<string, MarkSpec>;
  docAttrs: Record<string, AttributeSpec>;
  docAttrOwners: Record<string, string>;
}

/**
 * One key contributed by one extension. Bundles spec + owner so they stay in
 * lockstep — there's no way to update the spec without also setting the owner.
 */
interface Contribution<T> {
  spec: T;
  owner: string;
}

/**
 * Collision policy applied to each merger:
 *   `"warn"`  — later contribution overrides earlier, console.warn names both
 *               extensions. Used for nodes, marks, keymaps, commands, input
 *               handlers, markdown serializer rules, etc. — anywhere
 *               customization is legitimate but accidents need surfacing.
 *   `"throw"` — collision is a configuration error. Used for doc attrs and
 *               surface owners, where two extensions interpreting the same
 *               key would corrupt state silently.
 */
type CollisionPolicy = "warn" | "throw";

/**
 * Fold an extension's contributions into the accumulating map. On collision,
 * applies the chosen policy: warn-and-override (later wins) or throw with a
 * rename hint.
 *
 * Used everywhere the manager merges per-extension Record<string, T>
 * contributions — schema (nodes/marks/doc-attrs), runtime (commands/input
 * handlers/keymap), markdown (parser tokens/serializer rules). One merge
 * pattern, one diagnostic surface, one place to evolve.
 */
function mergeContributions<T>(
  target: Map<string, Contribution<T>>,
  incoming: Record<string, T>,
  newOwner: string,
  kind: string,
  policy: CollisionPolicy = "warn",
): void {
  for (const [key, spec] of Object.entries(incoming)) {
    const prev = target.get(key);
    if (prev) {
      if (policy === "throw") {
        throw new Error(
          `[ExtensionManager] ${kind} "${key}" is contributed by both ` +
            `"${prev.owner}" and "${newOwner}". ${kind}s must be unique across ` +
            `all extensions. Rename one (e.g. "${newOwner}_${key}") or remove ` +
            `the duplicate extension.`,
        );
      }
      console.warn(
        `[ExtensionManager] ${kind} "${key}" from extension "${newOwner}" silently overrides previous contribution from "${prev.owner}". ` +
          `If intentional, ignore this warning. If accidental, rename one or remove the duplicate.`,
      );
    }
    target.set(key, { spec, owner: newOwner });
  }
}

/**
 * Pluck specs out of a contribution map into a plain Record for downstream
 * consumers (ProseMirror Schema, MarkdownSerializer, etc.) that take plain
 * objects, not contribution wrappers.
 */
function specsOf<T>(target: Map<string, Contribution<T>>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, { spec }] of target) out[key] = spec;
  return out;
}

/**
 * Walk extensions once for Phase 1 schema contributions. This keeps
 * addNodes/addMarks/addDocAttrs in the same resolution pass and avoids
 * re-running phase-1 extension hooks just to expose doc-attr ownership.
 */
function collectPhase1SchemaContributions(extensions: Extension[]): Phase1SchemaContributions {
  // Track contributions with their owner. Baselines (`doc`, `text`) live at
  // output time, not in ownership state, so the warning message never has to
  // reference a synthetic "<baseline>" owner.
  const nodes = new Map<string, Contribution<NodeSpec>>();
  const marks = new Map<string, Contribution<MarkSpec>>();
  const docAttrs = new Map<string, Contribution<AttributeSpec>>();

  for (const ext of extensions) {
    const partial = ext.resolve(); // Phase 1 only — no schema yet
    mergeContributions(nodes, partial.nodes, partial.name, "Node", "warn");
    mergeContributions(marks, partial.marks, partial.name, "Mark", "warn");
    mergeContributions(docAttrs, partial.docAttrs, partial.name, "Doc attribute", "throw");
  }

  // Baseline override: an extension that contributes `doc` or `text` directly
  // bypasses the `addDocAttrs()` lane. The override is allowed (some plugins
  // genuinely need a custom doc shape), but it surfaces as a distinct warning
  // pointing at the supported path. We never overwrite ownership with the
  // baseline placeholder, so collisions between two real extensions still
  // attribute correctly.
  for (const baseline of ["doc", "text"] as const) {
    const contributor = nodes.get(baseline);
    if (contributor) {
      console.warn(
        `[ExtensionManager] Node "${baseline}" from extension "${contributor.owner}" overrides the ProseMirror baseline. ` +
          `If you wanted to add doc-level data, use addDocAttrs() — that's the supported path and it sync-checks across extensions.`,
      );
    }
  }

  // Project the contribution maps onto plain spec maps for Schema construction,
  // overlaying ProseMirror's required baselines.
  const nodeSpecs: Record<string, NodeSpec> = {
    doc: { content: "block+" },
    text: { group: "inline" },
    ...specsOf(nodes),
  };
  const markSpecs: Record<string, MarkSpec> = specsOf(marks);

  const docAttrSpecs: Record<string, AttributeSpec> = specsOf(docAttrs);
  const docAttrOwners: Record<string, string> = {};
  for (const [key, { owner }] of docAttrs) docAttrOwners[key] = owner;

  return { nodes: nodeSpecs, marks: markSpecs, docAttrs: docAttrSpecs, docAttrOwners };
}

function buildSchemaFromPhase1(contribs: Phase1SchemaContributions): Schema {
  // Defensive copy: callers (e.g. tests, or `getSchema` reading the snapshot
  // returned by `collectPhase1SchemaContributions`) shouldn't observe their
  // input mutated when the Schema is constructed.
  const nodes: Record<string, NodeSpec> = { ...contribs.nodes };
  const marks: Record<string, MarkSpec> = { ...contribs.marks };

  // Merge doc attrs into the doc node spec additively. The baseline `doc`
  // is always seeded by collectPhase1SchemaContributions, so `?? {}` is a
  // defensive fallback that satisfies noUncheckedIndexedAccess without a cast.
  if (Object.keys(contribs.docAttrs).length > 0) {
    const baseDoc: NodeSpec = nodes["doc"] ?? {};
    nodes["doc"] = {
      ...baseDoc,
      attrs: { ...(baseDoc.attrs ?? {}), ...contribs.docAttrs },
    };
  }

  return new Schema({ nodes, marks });
}

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
  return buildSchemaFromPhase1(collectPhase1SchemaContributions(extensions));
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
  /**
   * Map of doc-attr name → owning extension name, populated during schema
   * build. Used by collab bindings to whitelist syncable attrs and by future
   * error messages that need to attribute a problem to its owner.
   */
  private readonly docAttrOwners: Record<string, string>;

  constructor(extensions: Extension[]) {
    this.extensions = extensions;

    // Phase 1: build schema and capture doc-attr ownership in one pass.
    const phase1 = collectPhase1SchemaContributions(extensions);
    this.schema = buildSchemaFromPhase1(phase1);
    this.docAttrOwners = phase1.docAttrOwners;

    // Phase 2+: resolve everything else with the built schema in context
    this.resolved = extensions.map((ext) => ext.resolve(this.schema));
  }

  /**
   * Names of doc-level attributes declared by extensions via `addDocAttrs()`.
   * Returned as a fresh array — callers may mutate the result.
   *
   * Consumed by collab bindings as the whitelist of attrs that may be synced
   * across peers; attrs not in this list are private to the local editor.
   */
  getDocAttrNames(): string[] {
    return Object.keys(this.docAttrOwners);
  }

  /**
   * Map of doc-attr name → owning extension name. Returned as a fresh object —
   * callers may mutate the result. Useful for error messages that need to
   * attribute a problem to the extension that contributed an attr.
   */
  getDocAttrOwners(): Record<string, string> {
    return { ...this.docAttrOwners };
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
   * a plugin's internal mapping (e.g. initProseMirrorDoc for ySyncPlugin)
   * or app-supplied content (e.g. DefaultContent).
   *
   * Factories are invoked here — *after* every extension has resolved — so
   * the merged markdown parser tokens are available via `env.parseMarkdown`.
   */
  buildInitialDoc(): ProseMirrorNode | undefined {
    const tokens = this.buildMarkdownParserTokens();
    const env = {
      schema: this.schema,
      parseMarkdown: (text: string) => parseMarkdownToDoc(this.schema, tokens, text),
    };

    // Inspect registrations without executing them. Executing every factory
    // just to count "winners" would fire side effects on extensions whose
    // result was about to be ignored — e.g. DefaultContent's `addInitialDoc`
    // throws on invalid config and used to be skipped silently when an
    // earlier provider supplied a doc. The warning here surfaces multi-
    // provider registrations regardless of runtime outcome; the loop below
    // preserves the original short-circuit semantics.
    const registered = this.resolved.filter((ext) => ext.initialDocFactory);
    if (registered.length > 1) {
      console.warn(
        `[ExtensionManager] Multiple extensions contributed initial docs: ` +
          `${registered.map((ext) => ext.name).join(", ")}. ` +
          `The first non-null provider wins; the rest are ignored. ` +
          `Disable addInitialDoc() on the others or reorder so the intended provider runs first.`,
      );
    }

    for (const ext of registered) {
      const doc = ext.initialDocFactory!(env);
      if (doc != null) return doc;
    }
    return undefined;
  }

  /**
   * Resolve the PageConfig contributed by extensions through the `addPageConfig`
   * lane. Returns undefined when no extension contributes a value, in which
   * case Editor falls back to `EditorOptions.pageConfig`, then to
   * `defaultPageConfig`.
   *
   * Resolution: the first extension in registration order whose
   * `addPageConfig()` returns a non-undefined value wins. StarterKit holds
   * no opinion unless its `pagination` option is set, so the common
   * `[StarterKit, Pagination.configure(...)]` pattern resolves to the
   * standalone Pagination contribution without ambiguity. When two
   * extensions both contribute explicit configs, the first wins and a
   * warning surfaces the conflict.
   */
  buildPageConfig(): PageConfig | undefined {
    // Count contributors by actual return value, not by hook presence — an
    // extension whose `addPageConfig` returned undefined chose not to
    // contribute and shouldn't appear in the warning. Safe to inspect the
    // cached `pageConfig` here (resolved once at construction) because
    // addPageConfig is Phase 1 / side-effect-free; no re-execution.
    const contributors = this.resolved.filter((ext) => ext.pageConfig !== undefined);
    if (contributors.length > 1) {
      console.warn(
        `[ExtensionManager] Multiple extensions contributed page configs: ` +
          `${contributors.map((ext) => ext.name).join(", ")}. ` +
          `The first contribution wins; the rest are ignored. ` +
          `Disable addPageConfig() on the others or reorder so the intended provider runs first.`,
      );
    }
    return contributors[0]?.pageConfig;
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
    const bindings = new Map<string, Contribution<Command>>();
    for (const ext of this.resolved) {
      mergeContributions(bindings, ext.keymap, ext.name, "Keymap", "warn");
    }
    return specsOf(bindings);
  }

  /**
   * Merged command map from all extensions.
   * Exposed on the Editor as editor.commands.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildCommands(): Record<string, (...args: any[]) => Command> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged = new Map<string, Contribution<(...args: any[]) => Command>>();
    for (const ext of this.resolved) {
      mergeContributions(merged, ext.commands, ext.name, "Command", "warn");
    }
    return specsOf(merged);
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
   * Installed onto SurfaceRegistry via `setOwnerMediator()` during Editor
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
   * Export contributions from all extensions, in registration order.
   * Format packages call this at export time to collect handler contributions.
   */
  getExportContributions(): ExportContributionMap[] {
    return this.resolved.map((ext) => ext.exports);
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
    const merged = new Map<string, Contribution<InputHandler>>();
    for (const ext of this.resolved) {
      mergeContributions(merged, ext.inputHandlers, ext.name, "InputHandler", "warn");
    }
    return specsOf(merged);
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
    const merged = new Map<string, Contribution<MarkdownParserTokenSpec>>();
    for (const ext of this.resolved) {
      mergeContributions(
        merged,
        ext.markdownParserTokens,
        ext.name,
        "MarkdownParserToken",
        "warn",
      );
    }
    return specsOf(merged);
  }

  /**
   * Returns the `onEditorReady` callbacks from all extensions that define
   * one. Fires in both `Editor` (browser) and `ServerEditor` (headless) —
   * engine-only setup belongs here (collaboration document binding,
   * subscribers, plugin-state bootstrap).
   */
  buildEditorReadyCallbacks(): Array<
    (editor: IBaseEditor) => (() => void) | void
  > {
    return this.resolved
      .filter((ext) => ext.editorReadyCallback !== undefined)
      .map((ext) => ext.editorReadyCallback!);
  }

  /**
   * Returns the `onViewReady` callbacks from all extensions that define
   * one. Fires **only** in browser `Editor`, after view infrastructure
   * (layout / input bridge / surfaces / overlay layer) is initialised.
   * View-only setup belongs here (overlay handlers, redraw triggers,
   * selection wiring, layout reads).
   */
  buildViewReadyCallbacks(): Array<
    (editor: IEditor) => (() => void) | void
  > {
    return this.resolved
      .filter((ext) => ext.viewReadyCallback !== undefined)
      .map((ext) => ext.viewReadyCallback!);
  }

  /**
   * Merged markdown serializer rules from all extensions.
   * Used by Editor.getMarkdownSerializer() to build a MarkdownSerializer.
   */
  buildMarkdownSerializerRules(): Required<MarkdownSerializerRules> {
    const nodes = new Map<string, Contribution<MarkdownNodeSerializer>>();
    const marks = new Map<string, Contribution<MarkdownMarkSerializer>>();
    for (const ext of this.resolved) {
      mergeContributions(
        nodes,
        ext.markdownSerializerRules.nodes ?? {},
        ext.name,
        "MarkdownSerializerNode",
        "warn",
      );
      mergeContributions(
        marks,
        ext.markdownSerializerRules.marks ?? {},
        ext.name,
        "MarkdownSerializerMark",
        "warn",
      );
    }
    return { nodes: specsOf(nodes), marks: specsOf(marks) };
  }
}
