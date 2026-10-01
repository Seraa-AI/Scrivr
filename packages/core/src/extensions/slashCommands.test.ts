/**
 * An extension declares the slash entries that insert its own node.
 *
 * The menu used to hard-code its formatting entries and ask the source
 * providers directly, so an extension could not contribute to the menu that
 * inserts the thing it owns.
 */
import { describe, expect, it } from "vitest";
import { ServerEditor } from "../ServerEditor";
// Through the barrel: a declared spec is consumed by a host application, so a
// name dropped from `index.ts` fails here rather than there.
import type { SlashCommandSpec as ExportedSpec } from "../index";
import { StarterKit } from "./StarterKit";
import { Extension } from "./Extension";
import type { SlashCommandSpec } from "./types";

const kit = () => new ServerEditor({ extensions: [StarterKit] });

const titles = (specs: readonly SlashCommandSpec[]) => specs.map((s) => s.title);

describe("getSlashCommands", () => {
  it("collects what the built-in extensions declare", () => {
    const got = titles(kit().getSlashCommands());

    expect(got).toEqual(
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

  it("gives each entry its own id, so a menu can key on it", () => {
    const ids = kit().getSlashCommands().map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes an entry declared by a consumer's own extension", () => {
    const Clause = Extension.create({
      name: "clause",
      addSlashCommands(): SlashCommandSpec[] {
        return [{
          id: "clause/insert",
          command: "setParagraph",
          label: "§",
          title: "Clause",
          description: "Insert from the clause library",
        }];
      },
    });
    const editor = new ServerEditor({ extensions: [StarterKit, Clause] });

    expect(titles(editor.getSlashCommands())).toContain("Clause");
  });

  it("adds nothing for an extension that declares none", () => {
    const Quiet = Extension.create({ name: "quiet" });
    const editor = new ServerEditor({ extensions: [StarterKit, Quiet] });

    expect(titles(editor.getSlashCommands())).toEqual(titles(kit().getSlashCommands()));
  });
});

describe("resolveSlashCommands", () => {
  const searching = (
    onQuery: (query: string, signal: AbortSignal) => Promise<SlashCommandSpec[]>,
  ) =>
    Extension.create({
      name: "clauseSearch",
      addSlashCommandResolver() {
        return onQuery;
      },
    });

  const entry = (title: string): SlashCommandSpec => ({
    id: `clause/${title}`,
    command: "setParagraph",
    label: "§",
    title,
    description: "From the clause library",
  });

  it("returns what a resolver found for the query", async () => {
    const editor = new ServerEditor({
      extensions: [StarterKit, searching(async (q) => [entry(q)])],
    });

    const found = await editor.resolveSlashCommands("indemnity", new AbortController().signal);

    expect(titles(found)).toEqual(["indemnity"]);
  });

  it("is empty when nothing declares a resolver", async () => {
    const found = await kit().resolveSlashCommands("x", new AbortController().signal);

    expect(found).toEqual([]);
  });

  it("refuses to answer an abandoned query", async () => {
    // The menu queries as the reader types. A resolver that ignores its signal
    // would otherwise hand back entries for a query two keystrokes stale, and
    // the caller has no way to tell they are stale.
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
      extensions: [StarterKit, searching(async () => { calls += 1; return []; })],
    });

    await expect(editor.resolveSlashCommands("ind", controller.signal)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("hands the resolver the signal, so it can cancel its own work", async () => {
    let seen: AbortSignal | null = null;
    const controller = new AbortController();
    const editor = new ServerEditor({
      extensions: [StarterKit, searching(async (_q, signal) => { seen = signal; return []; })],
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
    // can name one whose extension this host did not install. Nothing to run
    // is not an error — there is simply no such entry here.
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ horizontalRule: false })],
    });
    const before = editor.getState().doc.toJSON();

    expect(() => editor.runCommand("insertHorizontalRule")).not.toThrow();
    expect(editor.getState().doc.toJSON()).toEqual(before);
  });

  it("exports the spec type a host annotates against", () => {
    const spec: ExportedSpec = {
      id: "host/entry",
      command: "setParagraph",
      label: "¶",
      title: "Text",
      description: "Plain paragraph",
    };

    expect(spec.command).toBe("setParagraph");
  });
});
