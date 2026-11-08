/**
 * UniqueId ships in `@scrivr/core` (and StarterKit); re-exported here for hosts
 * that imported it from the AI toolkit. Both id lookups are re-exported so an
 * agent host has them; each one's doc says when to use it.
 */
export { UniqueId, findNodeById } from "@scrivr/core";
export { findLiveNodeById } from "@scrivr/plugins";
