/**
 * Every node a document can hold must be able to say it was inserted or deleted.
 *
 * Tracking lives in a `dataTracked` attr on the node itself. A node that does
 * not declare one is not rejected by the engine — it is silently skipped, and
 * the change is either attributed to a neighbour or lost. Both of those read as
 * "no suggestion here" to a reviewer, which is the worst available answer for a
 * document under review.
 *
 * `doc` is exempt as the root — nothing inserts or deletes it — and `text`
 * carries its tracking on marks, which is what the mark lane is for.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { Table } from "../extensions/built-in/Table";

const EXEMPT = new Set(["doc", "text"]);

describe("schema tracking coverage", () => {
  it("declares dataTracked on every node a change can land on", () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, Table],
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });

    const missing = Object.entries(editor.getState().schema.nodes)
      .filter(([name]) => !EXEMPT.has(name))
      .filter(([, type]) => !("dataTracked" in (type.spec.attrs ?? {})))
      .map(([name]) => name);

    expect(missing).toEqual([]);
  });
});
