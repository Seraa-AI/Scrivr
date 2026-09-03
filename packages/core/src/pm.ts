/**
 * `@scrivr/core/pm` — the ProseMirror surface Scrivr is built on.
 *
 * Every package in this repo (and every consumer writing an extension) must run
 * against the *same* ProseMirror instance as the engine: `instanceof` checks on
 * Node, Slice, Selection and Plugin are load-bearing, and two copies of
 * prosemirror-model in one process break them silently.
 *
 * Importing from here instead of from `prosemirror-*` directly makes that
 * guarantee structural — `@scrivr/core` owns the versions, downstream packages
 * declare neither the dependency nor a peer range.
 *
 * `prosemirror-view` is deliberately absent: Scrivr renders to canvas and has no
 * `EditorView`, so view-only hooks (`Plugin.spec.view`, plugin `props`) never
 * run. Use `appendTransaction`, `addKeymap`, or `PasteTransformer` instead.
 */

export * from "prosemirror-model";
export * from "prosemirror-state";
export * from "prosemirror-transform";
export * from "prosemirror-commands";
export * from "prosemirror-keymap";
export * from "prosemirror-history";
export * from "prosemirror-inputrules";
export * from "prosemirror-schema-list";
export * from "prosemirror-markdown";
