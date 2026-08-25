// Input handling — keyboard, mouse, IME, clipboard
// Bridges browser events to document operations

export { PasteTransformer } from "./PasteTransformer";
export type {
  PasteOptions,
  PasteTransformerOptions,
} from "./PasteTransformer";
export {
  serializeSelectionToHtml,
  serializeSelectionToText,
  SLICE_DATA_ATTR,
} from "./ClipboardSerializer";
