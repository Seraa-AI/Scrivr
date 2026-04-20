// Side-effect: augments FormatHandlers with the "markdown" key.
import "./augmentation";
export type { MarkdownHandlers } from "./augmentation";

import type { BaseEditor } from "@scrivr/core";

/**
 * exportToMarkdown — serializes the editor's current document to a Markdown string.
 *
 * Uses the MarkdownSerializer built from all extension-contributed serializer rules,
 * so custom nodes and marks are automatically included if they implement
 * addMarkdownSerializerRules() in their Extension definition.
 *
 * Accepts any editor that extends BaseEditor (Editor, ServerEditor).
 *
 * @example
 * const md = exportToMarkdown(editor);
 * navigator.clipboard.writeText(md);
 */
export function exportToMarkdown(editor: BaseEditor): string {
  const serializer = editor.getMarkdownSerializer();
  return serializer.serialize(editor.getState().doc);
}
