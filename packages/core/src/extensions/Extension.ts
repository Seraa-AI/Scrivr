import type { Schema } from "prosemirror-model";
import type {
  ExtensionConfig,
  ExtensionContext,
  Phase1Context,
  ResolvedExtension,
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
 */
export class Extension<Options extends object = object> {
  readonly name: string;
  readonly options: Options;

  private readonly config: ExtensionConfig<Options>;

  private constructor(config: ExtensionConfig<Options>, options: Options) {
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
    return new Extension<Opts>(config, (config.defaultOptions ?? {}) as Opts);
  }

  /**
   * Returns a new Extension with the given options shallow-merged over the current ones.
   *
   * @example
   * Heading.configure({ levels: [1, 2, 3] })
   */
  configure(options: Partial<Options>): Extension<Options> {
    return new Extension(this.config, { ...this.options, ...options });
  }

  /**
   * Resolve this extension into a plain object that ExtensionManager can consume.
   *
   * @param schema — the fully built ProseMirror Schema.
   *                 Required for Phase 2 callbacks. Omit during schema-build phase.
   */
  resolve(schema?: Schema): ResolvedExtension {
    const { config, name, options } = this;

    // Phase 1 context — options available, schema not yet built
    const p1: Phase1Context<Options> = { name, options };

    // Phase 2 context — schema now available
    const p2: ExtensionContext<Options> = { name, options, schema: schema! };

    return {
      name,
      // Phase 1: called with p1 so addNodes/addMarks can access this.options
      nodes: config.addNodes?.call(p1) ?? {},
      marks: config.addMarks?.call(p1) ?? {},
      // Phase 2: only when schema is available
      plugins: schema ? (config.addProseMirrorPlugins?.call(p2) ?? []) : [],
      ...(schema && config.addInitialDoc
        ? (() => { const d = config.addInitialDoc.call(p2); return d != null ? { initialDoc: d } : {}; })()
        : {}),
      keymap:  schema ? (config.addKeymap?.call(p2) ?? {}) : {},
      commands: schema ? (config.addCommands?.call(p2) ?? {}) : {},
      // Phase 3/4: options available, no schema needed
      layoutHandlers: config.addLayoutHandlers?.call(p1) ?? {},
      blockStyles: config.addBlockStyles?.call(p1) ?? {},
      markDecorators: new Map(Object.entries(config.addMarkDecorators?.call(p1) ?? {})),
      fontModifiers: config.addFontModifiers?.call(p1) ?? new Map(),
      toolbarItems: config.addToolbarItems?.call(p1) ?? [],
      inputHandlers: config.addInputHandlers?.call(p1) ?? {},
      markdownRules: config.addMarkdownRules?.call(p1) ?? [],
      inputRules: schema ? (config.addInputRules?.call(p2) ?? []) : [],
      markdownParserTokens: config.addMarkdownParserTokens?.call(p1) ?? {},
      markdownSerializerRules: config.addMarkdownSerializerRules?.call(p1) ?? {},
      ...(config.onEditorReady
        ? { editorReadyCallback: (editor: IEditor) => config.onEditorReady!.call(p1, editor) }
        : {}),
    };
  }
}
