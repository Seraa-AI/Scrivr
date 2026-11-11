/**
 * What the sourced-block extension contributes to the slash menu.
 *
 * A menu entry has to be inert data — a command name and arguments — or the
 * host ends up fetching before it can dispatch, which is what pushed the first
 * consumer around the provider and made it duplicate `search` and `fetch`.
 */
import { describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import { ServerEditor } from "../../ServerEditor";
import { StarterKit } from "../StarterKit";
import { SourcedBlockExtension, type SourceProvider } from "./SourcedBlock";

const CONTENT = {
  resourceId: "cl_1",
  versionId: "v2",
  label: "Indemnity",
  contentJSON: {
    type: "paragraph",
    content: [{ type: "text", text: "The supplier shall indemnify." }],
  },
};

function provider(over: Partial<SourceProvider> = {}): SourceProvider {
  return {
    kind: "clause",
    search: async () => [{ resourceId: "cl_1", versionId: "v2", label: "Indemnity" }],
    fetch: async () => CONTENT,
    registerInstance: async () => {},
    ...over,
  };
}

const editorWith = (...providers: SourceProvider[]) =>
  new ServerEditor({
    extensions: [StarterKit, SourcedBlockExtension.configure({ providers })],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });

const sourcedBlocksIn = (editor: ServerEditor) => {
  const out: Record<string, unknown>[] = [];
  editor.getState().doc.descendants((node) => {
    if (node.type.name === "sourcedBlock") out.push(node.attrs);
    return true;
  });
  return out;
};

describe("the slash entries a source provider contributes", () => {
  it("resolves a query through the provider's own search", async () => {
    const searched: string[] = [];
    const editor = editorWith(
      provider({
        search: async (query) => {
          searched.push(query);
          return [{ resourceId: "cl_1", versionId: "v2", label: "Indemnity" }];
        },
      }),
    );

    const found = await editor.resolveSlashCommands("indem", new AbortController().signal);

    expect(searched).toEqual(["indem"]);
    expect(found.map((s) => s.label)).toEqual(["Indemnity"]);
  });

  it("carries identity, not content, so the entry stays data", () => {
    // `SourceSearchResult` is an id and a label with no body. That only pays
    // off once something fetches on select rather than on search.
    return editorWith(provider())
      .resolveSlashCommands("x", new AbortController().signal)
      .then(([entry]) => {
        expect(entry!.command).toBe("insertSourcedBlockFromSource");
        expect(entry!.args).toEqual([
          { kind: "clause", resourceId: "cl_1", versionId: "v2" },
        ]);
      });
  });

  it("does not fetch while searching", async () => {
    const fetch = vi.fn(async () => CONTENT);
    const editor = editorWith(provider({ fetch }));

    await editor.resolveSlashCommands("indem", new AbortController().signal);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("gives each provider its own resolver", async () => {
    const editor = editorWith(
      provider({ kind: "clause" }),
      provider({
        kind: "precedent",
        search: async () => [{ resourceId: "pr_9", versionId: "v1", label: "Precedent" }],
      }),
    );

    const found = await editor.resolveSlashCommands("x", new AbortController().signal);

    expect(found.map((s) => s.group)).toEqual(["CLAUSE", "PRECEDENT"]);
  });

  it("passes the signal through, so an abandoned search can stop", async () => {
    let seen: AbortSignal | undefined;
    const controller = new AbortController();
    const editor = editorWith(provider({ search: async (_q, signal) => { seen = signal; return []; } }));

    await editor.resolveSlashCommands("x", controller.signal);

    expect(seen).toBe(controller.signal);
  });

  it("contributes nothing when no provider was supplied", async () => {
    const editor = editorWith();

    expect(await editor.resolveSlashCommands("x", new AbortController().signal)).toEqual([]);
  });
});

describe("insertSourcedBlockFromSource", () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("fetches the content the identity names and inserts it", async () => {
    const editor = editorWith(provider());

    editor.runCommand("insertSourcedBlockFromSource", [
      { kind: "clause", resourceId: "cl_1", versionId: "v2" },
    ]);
    await settled();

    const [block] = sourcedBlocksIn(editor);
    expect(block).toBeDefined();
    expect(block!["resourceId"]).toBe("cl_1");
    expect(block!["versionId"]).toBe("v2");
    expect(editor.getState().doc.textContent).toContain("indemnify");
  });

  it("registers the instance, as inserting content directly does", async () => {
    let registered: string | undefined;
    const editor = editorWith(
      provider({ registerInstance: async (event) => { registered = event.resourceId; } }),
    );

    editor.runCommand("insertSourcedBlockFromSource", [
      { kind: "clause", resourceId: "cl_1", versionId: "v2" },
    ]);
    await settled();

    expect(registered).toBe("cl_1");
  });

  it("inserts nothing for a kind no provider claims", async () => {
    const editor = editorWith(provider());

    editor.runCommand("insertSourcedBlockFromSource", [
      { kind: "unknown", resourceId: "x", versionId: "v1" },
    ]);
    await settled();

    expect(sourcedBlocksIn(editor)).toEqual([]);
  });

  it("leaves the document alone when the fetch fails", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const editor = editorWith(
      provider({ fetch: async () => { throw new Error("library unreachable"); } }),
    );
    const before = editor.getState().doc.toJSON();

    editor.runCommand("insertSourcedBlockFromSource", [
      { kind: "clause", resourceId: "cl_1", versionId: "v2" },
    ]);
    await settled();

    expect(editor.getState().doc.toJSON()).toEqual(before);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("where a deferred insert lands", () => {
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** A provider whose fetch the test releases. */
  function heldProvider() {
    let release!: () => void;
    const p = provider({
      fetch: () =>
        new Promise((resolve) => {
          release = () => resolve(CONTENT);
        }),
    });
    return { provider: p, release: () => release() };
  }

  const twoParagraphs = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "AAA" }] },
      { type: "paragraph", content: [{ type: "text", text: "BBB" }] },
    ],
  };

  const editorWithDoc = (p: SourceProvider) =>
    new ServerEditor({
      extensions: [StarterKit, SourcedBlockExtension.configure({ providers: [p] })],
      content: twoParagraphs,
    });

  it("goes where the author asked, not where the caret ended up", async () => {
    // The clause used to replace whatever the author selected while it loaded.
    const held = heldProvider();
    const editor = editorWithDoc(held.provider);
    // Caret at the end of the first paragraph, where the menu leaves it after
    // deleting the author's "/clause".
    let state = editor.getState();
    editor.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, state.doc.child(0).nodeSize - 1)),
    );

    editor.runCommand("insertSourcedBlockFromSource", [
      { kind: "clause", resourceId: "cl_1", versionId: "v2" },
    ]);

    // The author selects the second paragraph's text while the fetch is out.
    state = editor.getState();
    const bbb = state.doc.child(0).nodeSize + 1;
    editor.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, bbb, bbb + 3)));
    held.release();
    await settled();

    const text = editor.getState().doc.textContent;
    expect(text).toContain("AAA");
    expect(text).toContain("BBB");
    // Between them, where it was asked for — not after the selection the
    // author had moved to by the time the fetch landed.
    expect(text.indexOf("indemnify")).toBeGreaterThan(text.indexOf("AAA"));
    expect(text.indexOf("indemnify")).toBeLessThan(text.indexOf("BBB"));
  });

  it("does not insert into an editor that stopped accepting writes", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const held = heldProvider();
    const editor = editorWithDoc(held.provider);

    editor.runCommand("insertSourcedBlockFromSource", [
      { kind: "clause", resourceId: "cl_1", versionId: "v2" },
    ]);
    editor.setReadOnly(true);
    held.release();
    await settled();

    expect(sourcedBlocksIn(editor)).toEqual([]);
    // Silence is the defect: the author's typed text was already deleted.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not register an instance into an editor that is gone", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    let registered = false;
    const held = heldProvider();
    const editor = editorWithDoc(
      provider({ ...held.provider, registerInstance: async () => { registered = true; } }),
    );

    editor.runCommand("insertSourcedBlockFromSource", [
      { kind: "clause", resourceId: "cl_1", versionId: "v2" },
    ]);
    editor.destroy();
    held.release();
    await settled();

    expect(registered).toBe(false);
    warn.mockRestore();
  });

  it("inserts into the editor that asked, when one configured extension serves two", async () => {
    // Keyed on the extension's options, this put the clause in the other
    // editor and left the one the author used empty.
    const held = heldProvider();
    const shared = SourcedBlockExtension.configure({ providers: [held.provider] });
    const a = new ServerEditor({
      extensions: [StarterKit, shared],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A-DOC" }] }] },
    });
    const b = new ServerEditor({
      extensions: [StarterKit, shared],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "B-DOC" }] }] },
    });

    a.runCommand("insertSourcedBlockFromSource", [
      { kind: "clause", resourceId: "cl_1", versionId: "v2" },
    ]);
    held.release();
    await settled();

    expect(sourcedBlocksIn(a)).toHaveLength(1);
    expect(sourcedBlocksIn(b)).toEqual([]);
  });
});
