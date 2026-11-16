/**
 * What a signer read, as evidence a host can store: which pages came into view
 * and left it, how far they got, and whether they reached the end. Page-level
 * only — a reader's dwell on a paragraph is not Scrivr's to record.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { ReadingProgress, type ReadingEvent } from "../index";

const T0 = Date.UTC(2026, 10, 11, 9, 0, 0);

const viewer = () => {
  const events: ReadingEvent[] = [];
  const editor = new ServerEditor({
    extensions: [StarterKit, ReadingProgress.configure({ onReading: (e) => events.push(e) })],
  });
  const view = (first: number, last: number, pageCount = 5, complete = true) =>
    editor.emit("pagesInView", { first, last, pageCount, complete });
  return { editor, events, view };
};

describe("ReadingProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("records the opening view as pages entered and the furthest page", () => {
    const { events, view } = viewer();
    view(1, 2);

    expect(events).toEqual([
      { type: "pageEntered", page: 1, at: T0 },
      { type: "pageEntered", page: 2, at: T0 },
      { type: "furthestPage", page: 2, at: T0 },
    ]);
  });

  it("records a page leaving view, with when", () => {
    const { events, view } = viewer();
    view(1, 2);
    vi.setSystemTime(T0 + 4000);
    events.length = 0;

    view(2, 3);

    expect(events).toEqual([
      { type: "pageLeft", page: 1, at: T0 + 4000 },
      { type: "pageEntered", page: 3, at: T0 + 4000 },
      { type: "furthestPage", page: 3, at: T0 + 4000 },
    ]);
  });

  it("does not move the furthest page back when the reader scrolls up", () => {
    const { events, view } = viewer();
    view(3, 4);
    events.length = 0;

    view(1, 1);

    expect(events.filter((e) => e.type === "furthestPage")).toEqual([]);
  });

  it("records reaching the end once", () => {
    const { events, view } = viewer();
    view(4, 5);
    view(3, 4);
    view(4, 5);

    expect(events.filter((e) => e.type === "reachedEnd")).toEqual([{ type: "reachedEnd", at: T0 }]);
  });

  it("does not record reaching the end of pages still being laid out", () => {
    const { events, view } = viewer();
    view(1, 2, 2, false);
    expect(events.filter((e) => e.type === "reachedEnd")).toEqual([]);

    view(1, 2, 2, true);
    expect(events.filter((e) => e.type === "reachedEnd")).toEqual([{ type: "reachedEnd", at: T0 }]);
  });

  it("closes the pages still in view when the viewer goes away", () => {
    const { editor, events, view } = viewer();
    view(2, 3);
    vi.setSystemTime(T0 + 9000);
    events.length = 0;

    editor.destroy();

    expect(events).toEqual([
      { type: "pageLeft", page: 2, at: T0 + 9000 },
      { type: "pageLeft", page: 3, at: T0 + 9000 },
    ]);
  });
});
