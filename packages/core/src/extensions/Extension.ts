import type { Schema } from "prosemirror-model";
import { KeymapPriority } from "./types";
import type {
  ExtendConfig,
  ExtendHookContext,
  ExtensionConfig,
  ExtensionHookName,
  ExtensionContext,
  InitialDocContext,
  Phase1Context,
  ResolvedExtension,
  IBaseEditor,
  IEditor,
} from "./types";

/**
 * Extension — the base unit of editor capability.
 *
 * Usage:
 *   const Bold = Extension.create({ name: 'bold', addMarks() { ... } });
 *
 *   // Use with defaults
 *   new Editor({ extensions: [Bold] });
 *
 *   // Configure before use
 *   new Editor({ extensions: [Bold.configure({ shortcut: false })] });
 *
 *   // Customise it: a new extension built on Bold's hooks
 *   const MyBold = Bold.extend({ addKeymap() { return { ...this.parent?.(), "Mod-Shift-b": cmd }; } });
 */
export class Extension<Options extends object = object> {
  readonly name: string;
  readonly options: Options;

  private readonly config: StoredConfig<Options>;

  private constructor(config: StoredConfig<Options>, options: Options) {
    this.name = config.name;
    this.options = options;
    this.config = config;
  }

  /**
   * Create a new Extension from a config object.
   * Returns an Extension instance with `defaultOptions` applied.
   */
  static create<Opts extends object = object>(
    config: ExtensionConfig<Opts>
  ): Extension<Opts> {
    return Extension.fromConfig(config);
  }

  /** Also takes an extended config, which names every hook, declared or not. */
  private static fromConfig<Opts extends object>(config: StoredConfig<Opts>): Extension<Opts> {
    return new Extension<Opts>(config, (config.defaultOptions ?? {}) as Opts);
  }

  /**
   * Returns a new Extension with the given options shallow-merged over the current ones.
   *
   * @example
   * Heading.configure({ levels: [1, 2, 3] })
   */
  configure(options?: Partial<Options>): Extension<Options> {
    return new Extension(this.config, { ...this.options, ...options });
  }

  /**
   * Returns a new extension built on this one. A hook in `overrides` replaces
   * this extension's, which it can still call as `this.parent` — to change
   * its result or add to it. Hooks left out stay this extension's. Options
   * are this extension's current ones with `overrides.defaultOptions` over
   * them, so a configured extension extends as configured; the new options
   * must keep the original's, since its hooks still read them. Don't narrow
   * an inherited option's type: the compiler allows it, but the inherited
   * value is not re-checked.
   *
   * `name` renames the extension. Keys its hooks write literally stay the
   * same; a key built from `this.name` follows the new name.
   *
   * @example
   * Heading.extend({
   *   addNodes() {
   *     const { heading, ...rest } = this.parent?.() ?? {};
   *     return { ...rest, heading: { ...heading, attrs: { ...heading?.attrs, anchor: { default: null } } } };
   *   },
   * })
   */
  extend<NewOptions extends Options = Options>(overrides: ExtendConfig<NewOptions>): Extension<NewOptions> {
    const base = this.config;
    const hooks: HookTable<NewOptions> = {
      addExtensions: layer(base.addExtensions, overrides.addExtensions),
      addNodes: layer(base.addNodes, overrides.addNodes),
      addMarks: layer(base.addMarks, overrides.addMarks),
      addDocAttrs: layer(base.addDocAttrs, overrides.addDocAttrs),
      addPageChrome: layer(base.addPageChrome, overrides.addPageChrome),
      addPageConfig: layer(base.addPageConfig, overrides.addPageConfig),
      addSurfaceOwner: layer(base.addSurfaceOwner, overrides.addSurfaceOwner),
      addExports: layer(base.addExports, overrides.addExports),
      addImports: layer(base.addImports, overrides.addImports),
      addCloneHandlers: layer(base.addCloneHandlers, overrides.addCloneHandlers),
      addProseMirrorPlugins: layer(base.addProseMirrorPlugins, overrides.addProseMirrorPlugins),
      addInitialDoc: layer(base.addInitialDoc, overrides.addInitialDoc),
      addKeymap: layer(base.addKeymap, overrides.addKeymap),
      addCommands: layer(base.addCommands, overrides.addCommands),
      addLayoutHandlers: layer(base.addLayoutHandlers, overrides.addLayoutHandlers),
      addInlineHandlers: layer(base.addInlineHandlers, overrides.addInlineHandlers),
      addMarkerPainters: layer(base.addMarkerPainters, overrides.addMarkerPainters),
      addBlockStyles: layer(base.addBlockStyles, overrides.addBlockStyles),
      addMarkDecorators: layer(base.addMarkDecorators, overrides.addMarkDecorators),
      addFontModifiers: layer(base.addFontModifiers, overrides.addFontModifiers),
      addToolbarItems: layer(base.addToolbarItems, overrides.addToolbarItems),
      addSlashCommands: layer(base.addSlashCommands, overrides.addSlashCommands),
      addNodeActions: layer(base.addNodeActions, overrides.addNodeActions),
      addSelectionBehavior: layer(base.addSelectionBehavior, overrides.addSelectionBehavior),
      addHitTester: layer(base.addHitTester, overrides.addHitTester),
      addHoverResolvers: layer(base.addHoverResolvers, overrides.addHoverResolvers),
      addSelectionGesture: layer(base.addSelectionGesture, overrides.addSelectionGesture),
      addPasteTransforms: layer(base.addPasteTransforms, overrides.addPasteTransforms),
      addPasteHtmlTransforms: layer(base.addPasteHtmlTransforms, overrides.addPasteHtmlTransforms),
      addCopyHtmlTransforms: layer(base.addCopyHtmlTransforms, overrides.addCopyHtmlTransforms),
      addPasteFiles: layer(base.addPasteFiles, overrides.addPasteFiles),
      addInputRules: layer(base.addInputRules, overrides.addInputRules),
      addMarkdownParserTokens: layer(base.addMarkdownParserTokens, overrides.addMarkdownParserTokens),
      addMarkdownSerializerRules: layer(base.addMarkdownSerializerRules, overrides.addMarkdownSerializerRules),
      addInputHandlers: layer(base.addInputHandlers, overrides.addInputHandlers),
      onEditorReady: layer(base.onEditorReady, overrides.onEditorReady),
      onViewReady: layer(base.onViewReady, overrides.onViewReady),
    };
    const defaultOptions: Partial<NewOptions> = { ...this.options, ...overrides.defaultOptions };
    const keymapPriority = overrides.keymapPriority ?? base.keymapPriority;
    return Extension.fromConfig<NewOptions>({
      ...hooks,
      name: overrides.name ?? base.name,
      defaultOptions,
      ...(keymapPriority !== undefined ? { keymapPriority } : {}),
    });
  }

  /**
   * Sub-extensions declared via `addExtensions()`, already configured by this
   * extension's own options. Returns a fresh array; empty for a leaf extension.
   *
   * Read by the manager during flattening, before any resolution phase — the
   * children then take part in every phase on equal footing with top-level
   * extensions.
   */
  children(): Extension[] {
    const { config, name, options } = this;
    const p1: Phase1Context<Options> = { name, options };
    return config.addExtensions?.call(p1) ?? [];
  }

  /**
   * Resolve this extension into a plain object that ExtensionManager can consume.
   *
   * @param schema — the fully built ProseMirror Schema.
   *                 Required for Phase 2 callbacks. Omit during schema-build phase.
   */
  resolve(schema?: Schema, editor?: () => IBaseEditor): ResolvedExtension {
    const { config, name, options } = this;

    // Phase 1 context — options available, schema not yet built
    const p1: Phase1Context<Options> = { name, options };

    // Phase 2 context — schema now available
    const p2: ExtensionContext<Options> = {
      name,
      options,
      schema: schema!,
      editor:
        editor ??
        (() => {
          throw new Error(
            `Extension "${name}": no editor owns this manager, so a contribution cannot reach one`,
          );
        }),
    };

    return {
      name,
      keymapPriority: config.keymapPriority ?? KeymapPriority.default,
      // Phase 1: called with p1 so addNodes/addMarks/addDocAttrs can access this.options
      nodes: config.addNodes?.call(p1) ?? {},
      marks: config.addMarks?.call(p1) ?? {},
      // docAttrs is also Phase 1 — contributions are merged into the doc
      // node's attrs spec during schema construction, before any Phase 2
      // context exists.
      docAttrs: config.addDocAttrs?.call(p1) ?? {},
      // Phase 1 — chrome contribution consumed by the layout aggregator.
      pageChrome: config.addPageChrome?.call(p1) ?? null,
      // Phase 1 — page-config contribution (size/margins/pageless). Manager
      // picks the first non-undefined contribution and warns when more than
      // one extension actually contributes a value.
      pageConfig: config.addPageConfig?.call(p1),
      // Phase 1 — surface owner registration consumed by Editor via
      // ExtensionManager.getSurfaceOwners() and installed on SurfaceRegistry.
      surfaceOwner: config.addSurfaceOwner?.call(p1) ?? null,
      // Phase 1 — format-specific export contributions collected by format
      // packages at export time (e.g. exportPdf walks addExports().pdf contributions).
      exports: config.addExports?.call(p1) ?? {},
      // Phase 1 — format-specific import contributions collected by format
      // packages at import time (e.g. importDocx walks addImports().docx contributions).
      imports: config.addImports?.call(p1) ?? {},
      // Phase 1 — clone participation hooks; BaseEditor runs them after the core
      // nodeId re-key when an editor is created with `clone`.
      cloneHandlers: config.addCloneHandlers?.call(p1) ?? [],
      // Phase 2: only when schema is available
      plugins: schema ? (config.addProseMirrorPlugins?.call(p2) ?? []) : [],
      ...(schema && config.addInitialDoc
        ? {
            initialDocFactory: (env): ReturnType<NonNullable<typeof config.addInitialDoc>> => {
              const ctx: InitialDocContext<Options> = { name, options, ...env };
              return config.addInitialDoc!.call(ctx);
            },
          }
        : {}),
      keymap:  schema ? (config.addKeymap?.call(p2) ?? {}) : {},
      commands: schema ? (config.addCommands?.call(p2) ?? {}) : {},
      // Phase 3/4: options available, no schema needed
      layoutHandlers: config.addLayoutHandlers?.call(p1) ?? {},
      inlineHandlers: config.addInlineHandlers?.call(p1) ?? {},
      markerPainters: config.addMarkerPainters?.call(p1) ?? {},
      blockStyles: config.addBlockStyles?.call(p1) ?? {},
      markDecorators: new Map(Object.entries(config.addMarkDecorators?.call(p1) ?? {})),
      fontModifiers: config.addFontModifiers?.call(p1) ?? new Map(),
      toolbarItems: config.addToolbarItems?.call(p1) ?? [],
      slashCommands: config.addSlashCommands?.call(p1) ?? [],
      nodeActions: config.addNodeActions?.call(p1) ?? [],
      selectionBehaviors: config.addSelectionBehavior?.call(p1) ?? [],
      hitTesters: config.addHitTester?.call(p1) ?? [],
      hoverResolvers: config.addHoverResolvers?.call(p1) ?? [],
      selectionGestures: config.addSelectionGesture?.call(p1) ?? [],
      inputHandlers: config.addInputHandlers?.call(p1) ?? {},
      pasteTransforms: config.addPasteTransforms?.call(p1) ?? [],
      pasteHtmlTransforms: config.addPasteHtmlTransforms?.call(p1) ?? [],
      copyHtmlTransforms: config.addCopyHtmlTransforms?.call(p1) ?? [],
      pasteFiles: config.addPasteFiles?.call(p1) ?? {},
      inputRules: schema ? (config.addInputRules?.call(p2) ?? []) : [],
      markdownParserTokens: config.addMarkdownParserTokens?.call(p1) ?? {},
      markdownSerializerRules: config.addMarkdownSerializerRules?.call(p1) ?? {},
      ...(config.onEditorReady
        ? { editorReadyCallback: (editor: IBaseEditor) => config.onEditorReady!.call(p1, editor) }
        : {}),
      ...(config.onViewReady
        ? { viewReadyCallback: (editor: IEditor) => config.onViewReady!.call(p1, editor) }
        : {}),
    };
  }
}

type HookTable<Options> = { [K in ExtensionHookName]: ExtensionConfig<Options>[K] | undefined };

/** A config as an extension holds it: an extended one names every hook, declared or not. */
type StoredConfig<Options> = Pick<ExtensionConfig<Options>, "name" | "defaultOptions" | "keymapPriority"> &
  Partial<HookTable<Options>>;

/** `override` in place of `base`, with `base` reachable as `this.parent`. */
function layer<Context, Args extends unknown[], Result>(
  base: ((this: Context, ...args: Args) => Result) | undefined,
  override: ((this: ExtendHookContext<Context, Args, Result>, ...args: Args) => Result) | undefined,
): ((this: Context, ...args: Args) => Result) | undefined {
  if (!override) return base;
  return function (this: Context, ...args: Args): Result {
    const parent = base && ((...parentArgs: Args) => base.apply(this, parentArgs));
    return override.apply({ ...this, parent }, args);
  };
}
