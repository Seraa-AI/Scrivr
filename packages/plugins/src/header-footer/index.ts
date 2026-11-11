export {
  HeaderFooter,
  DEFAULT_ACTIVE_EDITING_GAP,
  isHeaderFooterOptions,
} from "./HeaderFooter";
export type { HeaderFooterOptions } from "./HeaderFooter";
export type {
  HeaderFooterPolicy,
  HeaderFooterDefinition,
  HeaderFooterContent,
  SlotContext,
} from "./types";
export { resolveSlot } from "./resolveSlot";
export { resolveChrome } from "./resolveChrome";
// `SlotLayout` is public, so the accessor that reads it correctly has to be:
// `slot.layout` is the widest arrangement, and anyone painting a band from it
// directly reproduces the gap this pair exists to close.
export { slotLayoutForPage } from "./resolveChrome";
export type { ResolvedHeaderFooter, SlotLayout } from "./resolveChrome";
export { HeaderFooterSurfaceCache, HEADER_FOOTER_BLOCKED_NODES } from "./surfaces";
export type { SlotKey } from "./surfaces";
export { createHeaderFooterController } from "./HeaderFooterController";
export type { HeaderFooterController, HeaderFooterState } from "./HeaderFooterController";
