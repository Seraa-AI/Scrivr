import { Extension } from "../Extension";

/**
 * Options for the DefaultContent extension. Exactly one of `markdown` or
 * `json` must be provided. Both or neither throw at editor construction —
 * silent fallthrough would obscure misconfigured apps.
 */
export interface DefaultContentOptions {
  /** Markdown source. Parsed using the merged token map from all extensions. */
  markdown?: string;
  /** ProseMirror JSON document. Passed straight to `schema.nodeFromJSON`. */
  json?: Record<string, unknown>;
}

/**
 * DefaultContent — seeds the editor with a starting document.
 *
 * Use either markdown or JSON, not both. Constructor `content` on the editor
 * still takes precedence (per-instance overrides per-kit).
 *
 * @example
 * new Editor({ extensions: [StarterKit, DefaultContent.configure({ markdown: "# Hello" })] });
 *
 * @example
 * new Editor({ extensions: [StarterKit, DefaultContent.configure({ json: docJson })] });
 */
export const DefaultContent = Extension.create<DefaultContentOptions>({
  name: "defaultContent",
  addInitialDoc() {
    const { markdown, json } = this.options;
    const hasMarkdown = typeof markdown === "string";
    const hasJson = json != null && typeof json === "object";
    if (hasMarkdown && hasJson) {
      throw new Error(
        "[DefaultContent] Provide exactly one of `markdown` or `json` — got both.",
      );
    }
    if (!hasMarkdown && !hasJson) {
      throw new Error(
        "[DefaultContent] Provide exactly one of `markdown` or `json` — got neither.",
      );
    }
    if (hasMarkdown) return this.parseMarkdown(markdown);
    return this.schema.nodeFromJSON(json);
  },
});
