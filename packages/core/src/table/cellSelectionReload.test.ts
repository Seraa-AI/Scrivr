/**
 * A selection class registers its JSON id with prosemirror-state once per
 * process. A second registration is a duplicate Scrivr runtime and fails
 * fast — unless a dev server is reloading the module, which evaluates it
 * again while prosemirror-state keeps its registry.
 */
import { describe, expect, it } from "vitest";
import { TextSelection } from "prosemirror-state";
import { registerSelectionJsonId } from "./cellSelection";

class ReloadedSelection extends TextSelection {}

describe("registering a selection's JSON id", () => {
  it("goes on when a dev server reloads the module that registered it", () => {
    registerSelectionJsonId("test:reload", ReloadedSelection, true);
    expect(() => registerSelectionJsonId("test:reload", ReloadedSelection, true)).not.toThrow();
  });

  it("fails fast on a second registration outside a reload: a duplicate runtime", () => {
    registerSelectionJsonId("test:duplicate", ReloadedSelection, false);
    expect(() => registerSelectionJsonId("test:duplicate", ReloadedSelection, false)).toThrow(RangeError);
  });
});
