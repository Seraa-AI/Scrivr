// Imported through the package barrel on purpose: a consumer reads these
// types from the result of the calls that return them, and `tsc` fails here the
// moment one stops being exported.
import { describe, expect, it } from "vitest";
import type { RichBlocksOptions, SemanticEditResult } from "../index";

describe("the toolkit's public result and option types", () => {
  it("are reachable from the package", () => {
    const options = { view: "original", from: 0, to: 10 } satisfies RichBlocksOptions;
    const result = {
      applied: false, changed: [], stale: [], notFound: [], rejected: [], alreadyProposed: [], anchorProposedForDeletion: [],
    } satisfies SemanticEditResult;
    expect([options.view, result.applied]).toEqual(["original", false]);
  });
});
