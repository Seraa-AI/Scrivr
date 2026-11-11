import { describe, it, expect } from "vitest";
// Imported through the package barrel on purpose: consumers build their own
// popovers from these, and `tsc` fails here the moment one stops being exported.
import {
  createImageMenu,
  createLinkPopover,
  createTableMenu,
  DEFAULT_HOVER_HIDE_DELAY,
  DEFAULT_HOVER_SHOW_DELAY,
  subscribeHoverTarget,
} from "../index";
import type {
  HoverEvent,
  HoverOption,
  HoverResolver,
  HoverTarget,
  PagePoint,
  PopoverPresentation,
  TableMenuInfo,
} from "../index";

describe("the hover API a consumer builds popovers with", () => {
  it("is reachable from the package", () => {
    for (const fn of [createLinkPopover, createImageMenu, createTableMenu, subscribeHoverTarget]) {
      expect(typeof fn).toBe("function");
    }
    expect(DEFAULT_HOVER_SHOW_DELAY).toBeGreaterThan(DEFAULT_HOVER_HIDE_DELAY);
  });

  it("types a custom resolver, a hover event and a table peek", () => {
    const resolver = { node: "paragraph", kind: "paragraph" } satisfies HoverResolver;
    const target = { kind: "paragraph", surfaceId: "body", pos: 0, end: 2, at: 0 } satisfies HoverTarget;
    const point: PagePoint | null = null;
    const event = { targets: [target], point } satisfies HoverEvent;
    const presentation: PopoverPresentation = "peek";
    const hover: HoverOption = { showDelay: 0 };
    const info = { docPos: 0, rows: 1, columns: 1, headerRow: false, presentation } satisfies TableMenuInfo;

    expect([resolver.kind, event.targets[0]!.kind, info.presentation, hover]).toEqual([
      "paragraph",
      "paragraph",
      "peek",
      { showDelay: 0 },
    ]);
  });
});
