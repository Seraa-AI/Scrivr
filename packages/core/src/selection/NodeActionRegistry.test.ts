import { describe, it, expect, vi } from "vitest";
import { NodeActionRegistry } from "./NodeActionRegistry";
import type { NodeActionContext, NodeActionContribution } from "./types";

describe("NodeActionRegistry", () => {
  const mockCtx = {
    descriptor: { kind: "image" },
    state: {},
  } as unknown as NodeActionContext;

  it("throws on duplicate IDs within or across contributions", () => {
    const contribs: NodeActionContribution[] = [
      {
        kind: "image",
        actions: [{ id: "test.action", label: "Test", run: () => {} }],
      },
      {
        kind: "table",
        actions: [{ id: "test.action", label: "Test", run: () => {} }],
      },
    ];

    expect(() => new NodeActionRegistry(contribs)).toThrowError(
      'Duplicate NodeAction id: "test.action"'
    );
  });

  it("buckets actions by kind and evaluates when() condition", () => {
    const contribs: NodeActionContribution[] = [
      {
        kind: "image",
        actions: [
          { id: "action1", label: "A1", run: () => {} },
          { id: "action2", label: "A2", when: () => false, run: () => {} },
          { id: "action3", label: "A3", when: () => true, run: () => {} },
        ],
      },
      {
        kind: "table",
        actions: [{ id: "action4", label: "A4", run: () => {} }],
      },
    ];

    const registry = new NodeActionRegistry(contribs);
    const resolved = registry.resolve(mockCtx);

    expect(resolved).toHaveLength(2);
    expect(resolved.map((a) => a.id)).toEqual(["action1", "action3"]);
  });

  it("evaluates disabled() condition into disabledReason", () => {
    const contribs: NodeActionContribution[] = [
      {
        kind: "image",
        actions: [
          { id: "action1", label: "A1", disabled: () => "Offline", run: () => {} },
          { id: "action2", label: "A2", disabled: () => false, run: () => {} },
          { id: "action3", label: "A3", run: () => {} },
        ],
      },
    ];

    const registry = new NodeActionRegistry(contribs);
    const resolved = registry.resolve(mockCtx);

    expect(resolved).toHaveLength(3);
    expect(resolved.find((a) => a.id === "action1")?.disabledReason).toBe("Offline");
    expect(resolved.find((a) => a.id === "action2")?.disabledReason).toBe(false);
    expect(resolved.find((a) => a.id === "action3")?.disabledReason).toBe(false);
  });

  it("sorts by group, then order, then id", () => {
    const contribs: NodeActionContribution[] = [
      {
        kind: "image",
        actions: [
          { id: "z", label: "Z", group: "b", order: 200, run: () => {} },
          { id: "y", label: "Y", group: "b", order: 100, run: () => {} },
          { id: "x", label: "X", group: "b", order: 100, run: () => {} }, // ties with y, sorted by id
          { id: "w", label: "W", group: "a", run: () => {} }, // defaults to order 100
          { id: "v", label: "V", run: () => {} }, // no group defaults to ""
        ],
      },
    ];

    const registry = new NodeActionRegistry(contribs);
    const resolved = registry.resolve(mockCtx);

    const ids = resolved.map((a) => a.id);
    // "" comes before "a" comes before "b"
    // Within "b", order 100 comes before 200
    // Within order 100, "x" comes before "y"
    expect(ids).toEqual(["v", "w", "x", "y", "z"]);
  });
});
