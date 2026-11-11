/**
 * Async work that ends in a document edit.
 *
 * An extension that fetches before it can write has three problems nothing in
 * core answered: the position the author asked at has moved by the time the
 * answer arrives, the editor may no longer accept writes, and it may be gone
 * entirely. Each consumer was solving none of them.
 */
import { describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import { ServerEditor } from "./ServerEditor";
import { StarterKit } from "./extensions/StarterKit";

const twoParagraphs = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "AAA" }] },
    { type: "paragraph", content: [{ type: "text", text: "BBB" }] },
  ],
};

const editorAt = (pos: number) => {
  const editor = new ServerEditor({ extensions: [StarterKit], content: twoParagraphs });
  const state = editor.getState();
  editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  return editor;
};

/** A promise whose resolution the test controls. */
function held<T>() {
  let release!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { promise, release, fail };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("deferEdit", () => {
  it("edits at the position the author asked at, not the one they ended on", async () => {
    // The whole point. An insert that used the live selection would land
    // wherever the caret drifted to while the network answered.
    const editor = editorAt(2);
    const work = held<string>();
    let editedAt: number | null = null;

    editor.deferEdit({
      work: () => work.promise,
      edit: (_result, at) => {
        editedAt = at;
      },
    });
    const state = editor.getState();
    editor.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
    );
    work.release("content");
    await flush();

    expect(editedAt).toBe(2);
  });

  it("moves the position by what was typed in front of it", async () => {
    const editor = editorAt(4);
    const work = held<string>();
    let editedAt: number | null = null;

    editor.deferEdit({ work: () => work.promise, edit: (_r, at) => { editedAt = at; } });
    editor.applyTransaction(editor.getState().tr.insertText("XX", 1));
    work.release("content");
    await flush();

    expect(editedAt).toBe(6);
  });

  it("takes an explicit position over the selection", async () => {
    const editor = editorAt(2);
    const work = held<string>();
    let editedAt: number | null = null;

    editor.deferEdit({ at: 7, work: () => work.promise, edit: (_r, at) => { editedAt = at; } });
    work.release("content");
    await flush();

    expect(editedAt).toBe(7);
  });

  it("abandons the edit when the text it was anchored to is gone", async () => {
    // Nothing can place an edit that was about words the reader deleted.
    const editor = editorAt(6);
    const work = held<string>();
    const edit = vi.fn();
    const abandoned = vi.fn();

    editor.deferEdit({ work: () => work.promise, edit, onAbandoned: abandoned });
    const state = editor.getState();
    editor.applyTransaction(state.tr.delete(5, 10));
    work.release("content");
    await flush();

    expect(edit).not.toHaveBeenCalled();
    expect(abandoned).toHaveBeenCalledWith("anchor-removed", undefined);
  });

  it("abandons the edit when the editor stopped accepting writes", async () => {
    const editor = editorAt(2);
    const work = held<string>();
    const edit = vi.fn();
    const abandoned = vi.fn();

    editor.deferEdit({ work: () => work.promise, edit, onAbandoned: abandoned });
    editor.setReadOnly(true);
    work.release("content");
    await flush();

    expect(edit).not.toHaveBeenCalled();
    expect(abandoned).toHaveBeenCalledWith("read-only", undefined);
  });

  it("abandons the edit when the editor is gone", async () => {
    const editor = editorAt(2);
    const work = held<string>();
    const edit = vi.fn();
    const abandoned = vi.fn();

    editor.deferEdit({ work: () => work.promise, edit, onAbandoned: abandoned });
    editor.destroy();
    work.release("content");
    await flush();

    expect(edit).not.toHaveBeenCalled();
    expect(abandoned).toHaveBeenCalledWith("destroyed", undefined);
  });

  it("reports the work's own failure rather than guessing at it", async () => {
    const editor = editorAt(2);
    const work = held<string>();
    const edit = vi.fn();
    const abandoned = vi.fn();
    const failure = new Error("library unreachable");

    editor.deferEdit({ work: () => work.promise, edit, onAbandoned: abandoned });
    work.fail(failure);
    await flush();

    expect(edit).not.toHaveBeenCalled();
    expect(abandoned).toHaveBeenCalledWith("failed", failure);
  });

  it("does not confuse a failure in the edit with a failure of the work", async () => {
    const editor = editorAt(2);
    const work = held<string>();
    const abandoned = vi.fn();

    editor.deferEdit({
      work: () => work.promise,
      edit: () => {
        throw new Error("bad content");
      },
      onAbandoned: abandoned,
    });
    work.release("content");
    await flush();

    expect(abandoned).toHaveBeenCalledWith("edit-failed", expect.any(Error));
  });

  it("stops mapping an anchor once its edit has run", async () => {
    // A pending anchor costs a map per transaction; a settled one must not.
    const editor = editorAt(2);
    const work = held<string>();
    const edit = vi.fn();

    editor.deferEdit({ work: () => work.promise, edit });
    work.release("content");
    await flush();
    editor.applyTransaction(editor.getState().tr.insertText("Z", 1));

    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("keeps two deferred edits apart", async () => {
    const editor = editorAt(2);
    const first = held<string>();
    const second = held<string>();
    const seen: Array<[string, number]> = [];

    editor.deferEdit({ at: 2, work: () => first.promise, edit: (r, at) => seen.push([r, at]) });
    editor.deferEdit({ at: 7, work: () => second.promise, edit: (r, at) => seen.push([r, at]) });
    second.release("second");
    await flush();
    first.release("first");
    await flush();

    expect(seen).toEqual([["second", 7], ["first", 2]]);
  });
});
