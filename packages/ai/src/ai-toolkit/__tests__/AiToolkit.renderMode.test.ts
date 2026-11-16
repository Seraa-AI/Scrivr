/**
 * A host that draws its own review UI turns the suggestion colours off through
 * the toolkit it installs, as it turns off TrackChanges' own.
 */
import { describe, expect, it } from "vitest";
import { StarterKit } from "@scrivr/core";
import { AiToolkit } from "../AiToolkit";
import { ViewEditorDouble } from "./viewEditorDouble";

function paintersWith(toolkit: ReturnType<typeof AiToolkit.configure>): number {
  const editor = new ViewEditorDouble({ extensions: [StarterKit, toolkit] });
  editor.mountView();
  return editor.painters.length;
}

describe("AiToolkit and the suggestion overlay", () => {
  it("passes the suggestion overlay's renderMode through", () => {
    const painted = paintersWith(AiToolkit.configure({}));
    expect(paintersWith(AiToolkit.configure({ aiSuggestion: { renderMode: "none" } }))).toBe(painted - 1);
  });

  it("paints the same with the suggestion overlay's own options as by default", () => {
    expect(paintersWith(AiToolkit.configure({ aiSuggestion: { renderMode: "all" } }))).toBe(paintersWith(AiToolkit.configure({})));
  });
});
