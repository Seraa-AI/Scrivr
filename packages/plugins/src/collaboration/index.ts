export { Collaboration } from "./Collaboration";
export { CollaborationCursor } from "./CollaborationCursor";
export { collaborationRegistry } from "./collaborationState";
export type { CollabState } from "./collaborationState";
export { seedDocAttrs, readDocAttrs } from "./docAttrs";
export { DOC_ATTRS_MAP_NAME, isDocAttrEnvelope } from "./YBinding";
export type { DocAttrEnvelope } from "./YBinding";
// Type-only: `CollabState.binding` is this, so a host reading the registry has
// to be able to name it. Constructing one is the extension's business.
export type { YBinding } from "./YBinding";
