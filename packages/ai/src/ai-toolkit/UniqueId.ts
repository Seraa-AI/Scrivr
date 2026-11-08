/**
 * UniqueId ships in `@scrivr/core` (and StarterKit), so stable block ids are the
 * default with or without the AI toolkit; re-exported here for back-compat.
 *
 * Two lookups, re-exported so an agent host has both:
 * - `findLiveNodeById` — the block a person sees. Use it for an agent's ids: a
 *   pending move leaves a deleted copy under the same id, and this skips it.
 * - `findNodeById` — the first node with the id, copy or not. Use it to ask
 *   whether an id exists at all, or in a document without track changes.
 */
export { UniqueId, findNodeById } from "@scrivr/core";
export { findLiveNodeById } from "@scrivr/plugins";
