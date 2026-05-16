/**
 * Shared test fixtures for `@scrivr/plugins` tests.
 *
 * The starting point for any plugin test that needs a real ProseMirror
 * schema / type / node — building a `ServerEditor` is the canonical path
 * (`StarterKit` schema, real lifecycle), and `{} as any` stubs are not
 * acceptable. Reuse this helper instead of newing up `ServerEditor` inline.
 */
import { ServerEditor } from "@scrivr/core";
import type { Node, NodeType, Schema } from "prosemirror-model";

export interface RealSchema {
  /** Built from StarterKit — identical to the production read-path schema. */
  schema: Schema;
  /** A fresh `doc` node from StarterKit's default content (one empty paragraph). */
  doc: Node;
  /** The `paragraph` node type — handy for change/fixture stubs that need a NodeType. */
  paragraphType: NodeType;
  /** A bare `paragraph` node — handy for change/fixture stubs that need a Node. */
  paragraphNode: Node;
}

/**
 * Build a real StarterKit schema + a `doc` ready for fixture use. Spins up a
 * one-off `ServerEditor` per call — cheap and side-effect-free, so each test
 * gets a fresh snapshot.
 */
export function realSchema(): RealSchema {
  const state = new ServerEditor().getState();
  const schema = state.schema;
  const paragraphType = schema.nodes["paragraph"]!;
  return {
    schema,
    doc: state.doc,
    paragraphType,
    paragraphNode: paragraphType.create(),
  };
}
