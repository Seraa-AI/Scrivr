import type { IEditor } from "@scrivr/core";
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
export const aiToolkitRegistry = new WeakMap<IEditor, AiToolkitAPI>();

/**
 * Returns the AiToolkitAPI for an editor, or null if the AiToolkit extension
 * has not been added to that editor's extension list.
 */
export function getAiToolkit(editor: IEditor): AiToolkitAPI | null {
  return aiToolkitRegistry.get(editor) ?? null;
}
