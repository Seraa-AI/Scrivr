/**
 * An extension declares the slash entries that insert what it owns.
 *
 * The menu used to hard-code its formatting entries and ask the source
 * providers directly, so an extension could not contribute to the menu that
 * inserts its own node — the one contribution of its kind that `addToolbarItems`
 * and `addNodeActions` already had and this did not.
 */
import { describe, expect, it, vi } from "vitest";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "./StarterKit";
import { Extension } from "./Extension";
// Through the barrel: a host annotates against these, so one dropped from
// `index.ts` fails here rather than there.
import type {
  SlashCommandContribution,
  SlashCommandSpec,
} from "../index";
import { DEFAULT_SLASH_ORDER } from "../index";

const kit = () => new ServerEditor({ extensions: [StarterKit] });

const labels = (specs: readonly SlashCommandSpec[]) => specs.map((s) => s.label);

describe("getSlashCommands", () => {
  it("collects what the built-in extensions declare", () => {
    expect(labels(kit().getSlashCommands())).toEqual(
      expect.arrayContaining([
        "Text",
        "Heading 1",
        "Heading 2",
        "Heading 3",
        "Bullet list",
        "Ordered list",
        "Code block",
        "Divider",
      ]),
    );
  });

  it("names a command the editor can actually run", () => {
    const editor = kit();

    for (const spec of editor.getSlashCommands()) {
      expect(typeof editor.commands[spec.command]).toBe("function");
    }
  });

  it("gives each entry its own namespaced id, so a menu can key on it", () => {
    const ids = kit().getSlashCommands().map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.includes("."))).toBe(true);
  });

  it("includes an entry declared by a consumer's own extension", () => {
    const Clause = Extension.create({
      name: "clause",
      addSlashCommands(): SlashCommandContribution[] {
        return [{
          items: [{
            id: "clause.insert",
            label: "Clause",
            description: "Insert from the clause library",
            command: "setParagraph",
          }],
        }];
      },
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Clause] });

    expect(labels(editor.getSlashCommands())).toContain("Clause");
  });

  it("adds nothing for an extension that declares none", () => {
    const Quiet = Extension.create({ name: "quiet" });
    const editor = new ServerEditor({ extensions: [StarterKit, Quiet] });

    expect(labels(editor.getSlashCommands())).toEqual(labels(kit().getSlashCommands()));
  });

  it("takes a contribution that is only a resolver, with no items", () => {
    const Search = Extension.create({
      name: "search",
      addSlashCommands: (): SlashCommandContribution[] => [{ resolve: async () => [] }],
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Search] });

    expect(labels(editor.getSlashCommands())).toEqual(labels(kit().getSlashCommands()));
  });
});

describe("merging entries", () => {
  const entry = (
    id: string,
    over: Partial<SlashCommandSpec> = {},
  ): SlashCommandSpec => ({ id, label: id, command: "setParagraph", ...over });

  const editorWith = (...items: SlashCommandSpec[]) =>
    new ServerEditor({
      extensions: [
        Extension.create({
          name: "host",
          addSlashCommands: (): SlashCommandContribution[] => [{ items }],
        }),
        StarterKit,
      ],
    });

  it("sorts by order within a group", () => {
    const editor = editorWith(
      entry("c", { group: "g", order: 30 }),
      entry("a", { group: "g", order: 10 }),
      entry("b", { group: "g", order: 20 }),
    );

    expect(labels(editor.getSlashCommands()).slice(0, 3)).toEqual(["a", "b", "c"]);
  });

  it("keeps a group together, in the order it was first contributed", () => {
    // Not alphabetically: a renamed group would otherwise reorder the menu.
    const editor = editorWith(
      entry("zebra-1", { group: "zebra", order: 10 }),
      entry("alpha-1", { group: "alpha", order: 10 }),
      entry("zebra-2", { group: "zebra", order: 20 }),
    );

    expect(labels(editor.getSlashCommands()).slice(0, 3)).toEqual([
      "zebra-1",
      "zebra-2",
      "alpha-1",
    ]);
  });

  it("sorts an entry that states no order as if it stated the default", () => {
    const editor = editorWith(
      entry("explicit-late", { group: "g", order: DEFAULT_SLASH_ORDER + 1 }),
      entry("implicit", { group: "g" }),
      entry("explicit-early", { group: "g", order: DEFAULT_SLASH_ORDER - 1 }),
    );

    expect(labels(editor.getSlashCommands()).slice(0, 3)).toEqual([
      "explicit-early",
      "implicit",
      "explicit-late",
    ]);
  });
});

describe("resolveSlashCommands", () => {
  const searching = (
    ...resolvers: Array<(query: string, signal: AbortSignal) => Promise<SlashCommandSpec[]>>
  ) =>
    Extension.create({
      name: "clauseSearch",
      addSlashCommands: (): SlashCommandContribution[] =>
        resolvers.map((resolve) => ({ resolve })),
    });

  const entry = (label: string, over: Partial<SlashCommandSpec> = {}): SlashCommandSpec => ({
    id: `clause.${label}`,
    label,
    command: "setParagraph",
    ...over,
  });

  const entryAt = (label: string, order: number): SlashCommandSpec =>
    entry(label, { group: "g", order });

  it("returns what a resolver found for the query", async () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, searching(async (q) => [entry(q)])],
    });

    const found = await editor.resolveSlashCommands("indemnity", new AbortController().signal);

    expect(labels(found)).toEqual(["indemnity"]);
  });

  it("fans out over every resolver one extension contributes", () => {
    // One extension fronting several sources gives each its own resolver —
    // which is the shape the clause library needs, one per provider.
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        searching(
          async () => [entry("from-a", { group: "A" })],
          async () => [entry("from-b", { group: "B" })],
        ),
      ],
    });

    return expect(
      editor.resolveSlashCommands("x", new AbortController().signal).then(labels),
    ).resolves.toEqual(["from-a", "from-b"]);
  });

  it("is empty when nothing declares a resolver", async () => {
    const found = await kit().resolveSlashCommands("x", new AbortController().signal);

    expect(found).toEqual([]);
  });

  it("drops a resolver that fails and keeps the rest", async () => {
    // One provider being down must not empty the menu.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        searching(
          async () => {
            throw new Error("library unreachable");
          },
          async () => [entry("still-here")],
        ),
      ],
    });

    const found = await editor.resolveSlashCommands("x", new AbortController().signal);

    expect(labels(found)).toEqual(["still-here"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("resolves to nothing, rather than rejecting, when every resolver fails", async () => {
    // Rejecting would be an error state, and a caller cannot tell one from an
    // abandoned query.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        searching(async () => {
          throw new Error("down");
        }),
      ],
    });

    await expect(
      editor.resolveSlashCommands("x", new AbortController().signal),
    ).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops a resolver that answers with something that is not a list", async () => {
    // A provider SDK returning `data` from a fetch wrapper lands here. The
    // spread used to throw inside the method, losing every other resolver's
    // entries and rejecting a call that should have degraded.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        searching(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (async () => undefined) as any,
          async () => [entry("still-here")],
        ),
      ],
    });

    const found = await editor.resolveSlashCommands("x", new AbortController().signal);

    expect(labels(found)).toEqual(["still-here"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("settles when the query is abandoned, even if a resolver never answers", async () => {
    // A resolver that ignores its signal would otherwise leave the caller
    // waiting forever, and retain one chain per keystroke.
    const controller = new AbortController();
    const editor = new ServerEditor({
      extensions: [StarterKit, searching(() => new Promise(() => {}))],
    });

    const pending = editor.resolveSlashCommands("x", controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it("sorts an entry whose order is not a real number as if it stated none", async () => {
    // One broken order used to break transitivity for its whole group, so two
    // entries that both stated a valid order came out reversed.
    const editor = new ServerEditor({
      extensions: [
        Extension.create({
          name: "host",
          addSlashCommands: (): SlashCommandContribution[] => [{
            items: [
              entryAt("ten", 10),
              entryAt("broken", Number.NaN),
              entryAt("five", 5),
            ],
          }],
        }),
        StarterKit,
      ],
    });

    expect(labels(editor.getSlashCommands()).slice(0, 3)).toEqual(["five", "ten", "broken"]);
  });

  it("merges resolved entries by group then order", async () => {
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        searching(
          async () => [entry("second", { group: "g", order: 20 })],
          async () => [entry("first", { group: "g", order: 10 })],
        ),
      ],
    });

    const found = await editor.resolveSlashCommands("x", new AbortController().signal);

    expect(labels(found)).toEqual(["first", "second"]);
  });

  it("refuses to answer an abandoned query", async () => {
    // The menu queries as the reader types. A resolver that ignores its signal
    // would otherwise hand back entries for a query two keystrokes stale.
    const controller = new AbortController();
    const editor = new ServerEditor({
      extensions: [StarterKit, searching(async () => [entry("late")])],
    });

    const pending = editor.resolveSlashCommands("ind", controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow();
  });

  it("does not start a resolver for a query already abandoned", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        searching(async () => {
          calls += 1;
          return [];
        }),
      ],
    });

    await expect(editor.resolveSlashCommands("ind", controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("hands the resolver the signal, so it can cancel its own work", async () => {
    let seen: AbortSignal | null = null;
    const controller = new AbortController();
    const editor = new ServerEditor({
      extensions: [
        StarterKit,
        searching(async (_q, signal) => {
          seen = signal;
          return [];
        }),
      ],
    });

    await editor.resolveSlashCommands("ind", controller.signal);

    expect(seen).toBe(controller.signal);
  });
});

describe("runCommand", () => {
  it("runs a command a declared spec names, with the args it carries", () => {
    const editor = kit();
    editor.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
    });

    editor.runCommand("setHeading2");

    expect(editor.getState().doc.child(0).type.name).toBe("heading");
    expect(editor.getState().doc.child(0).attrs["level"]).toBe(2);
  });

  it("ignores a command this editor was not built with", () => {
    // Command names are global once a package augments `Commands`, so a spec
    // can name one whose extension this host did not install.
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ horizontalRule: false })],
    });
    const before = editor.getState().doc.toJSON();

    expect(() => editor.runCommand("insertHorizontalRule")).not.toThrow();
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });
});
