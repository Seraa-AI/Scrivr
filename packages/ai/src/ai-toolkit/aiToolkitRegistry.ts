import type { IBaseEditor } from "@scrivr/core";
import type { AiToolkitAPI } from "./AiToolkit";

/**
 * Registry that maps each Editor instance to its AiToolkitAPI.
 * Populated by AiToolkit.onEditorReady(); cleared on destroy.
 *
 * @example
 * const ai = getAiToolkit(editor);
 * if (ai) {
 *   const context = ai.getContext({ beforeChars: 1000 });
 *   await ai.streamGhostText(nodeId, stream);
 * }
 */
export const aiToolkitRegistry = new WeakMap<IBaseEditor, AiToolkitAPI>();

/**
 * Returns the AiToolkitAPI for an editor, or null if the AiToolkit extension
 * has not been added to that editor's extension list.
 *
 * Accepts any `IBaseEditor`, so a headless `ServerEditor` reaches the same
 * read/stream/suggestion API as the browser `Editor` — only the overlay
 * painting is view-only.
 */
export function getAiToolkit(editor: IBaseEditor): AiToolkitAPI | null {
  return aiToolkitRegistry.get(editor) ?? null;
}
