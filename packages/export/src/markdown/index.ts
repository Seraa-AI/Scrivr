import type { Editor } from "@scrivr/core";

/**
 * exportToMarkdown — serializes the editor's current document to a Markdown string.
 *
 * Uses the MarkdownSerializer built from all extension-contributed serializer rules,
 * so custom nodes and marks are automatically included if they implement
 * addMarkdownSerializerRules() in their Extension definition.
 *
 * @example
 * const md = exportToMarkdown(editor);
 * navigator.clipboard.writeText(md);
 */
export function exportToMarkdown(editor: Editor): string {
  const serializer = editor.getMarkdownSerializer();
  return serializer.serialize(editor.getState().doc);
}
