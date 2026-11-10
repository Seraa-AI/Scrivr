/**
 * The report's rules, on the recorder alone.
 *
 * The pipeline tests (`reportPipeline.test.ts`) show the report a real
 * import or export returns. These pin down what the recorder does with each
 * call, so a pipeline result can be read without guessing.
 */

import { describe, it, expect } from "vitest";
import { ServerEditor, type DocxDiagnostic } from "@scrivr/core";
import { createDocxImportContext } from "./import/context";
import {
  HANDLER_RETURNED_NOTHING,
  assignOwned,
  createReportRecorder,
  entryOf,
  insideDropped,
  ownedBundles,
  ownerOf,
  reportRecorderOf,
  type HandlerOwner,
} from "./report";

const always = (): boolean => true;

describe("report recorder — the outcome of a handled item", () => {
  it("counts an item kept when its handler returns content", () => {
    const recorder = createReportRecorder();
    recorder.handle("paragraph", "paragraph", () => "built", always);
    expect(recorder.snapshot()).toEqual({
      counts: { paragraph: { kept: 1, dropped: 0, changed: 0 } },
      entries: [],
    });
  });

  it("records a drop, owned by the handler's extension, when it returns nothing", () => {
    const recorder = createReportRecorder();
    recorder.handle("image", "image", () => null, (built) => built !== null);
    expect(recorder.snapshot().entries).toEqual([
      { outcome: "dropped", kind: "image", reason: HANDLER_RETURNED_NOTHING, owner: "image", count: 1 },
    ]);
  });

  it("records the reason the dispatcher gives for an item that came back empty", () => {
    const recorder = createReportRecorder();
    recorder.handle("link", "link", () => "unwrapped", () => false, "wrapper left the run unwrapped");
    expect(recorder.snapshot().entries[0]?.reason).toBe("wrapper left the run unwrapped");
  });

  it("lets the handler's own account stand in for the converter's", () => {
    const recorder = createReportRecorder();
    recorder.handle("list", "list", () => {
      recorder.reporter.kept("list", 3);
      return "built";
    }, always);
    recorder.handle("image", "image", () => {
      recorder.reporter.dropped("image", "the part is missing");
      return "placeholder";
    }, always);

    const report = recorder.snapshot();
    expect(report.counts["list"]).toEqual({ kept: 3, dropped: 0, changed: 0 });
    expect(report.counts["image"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
    expect(report.entries).toEqual([
      { outcome: "dropped", kind: "image", reason: "the part is missing", owner: "image", count: 1 },
    ]);
  });

  it("still records the outcome when the handler only reported other kinds", () => {
    const recorder = createReportRecorder();
    recorder.handle("list", "list", () => {
      recorder.reporter.kept("listItem", 2);
      return "built";
    }, always);
    const { counts } = recorder.snapshot();
    expect(counts["list"]?.kept).toBe(1);
    expect(counts["listItem"]?.kept).toBe(2);
  });

  it("does not take a count of zero as the handler's account of its item", () => {
    const recorder = createReportRecorder();
    recorder.handle("paragraph", "paragraph", () => {
      recorder.reporter.kept("paragraph", 0);
      return null;
    }, (built) => built !== null);
    expect(recorder.snapshot().counts["paragraph"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
  });

  it("does not let a change note stand in for an outcome", () => {
    const recorder = createReportRecorder();
    recorder.handle("paragraph", "paragraph", () => {
      recorder.reporter.changed("paragraph", "spacing ignored");
      recorder.reporter.changed("paragraph", "indent ignored");
      return "built";
    }, always);
    const report = recorder.snapshot();
    expect(report.counts["paragraph"]).toEqual({ kept: 1, dropped: 0, changed: 2 });
    expect(report.entries.map((e) => e.reason)).toEqual(["spacing ignored", "indent ignored"]);
  });
});

describe("report recorder — owners", () => {
  it("files each call under the innermost running handler", () => {
    const recorder = createReportRecorder();
    recorder.handle("table", "table", () => {
      recorder.handle("paragraph", "paragraph", () => {
        recorder.reporter.changed("paragraph", "inner");
        return "cell paragraph";
      }, always);
      recorder.reporter.changed("table", "outer");
      return "built";
    }, always);

    expect(recorder.snapshot().entries.map((e) => [e.reason, e.owner])).toEqual([
      ["inner", "paragraph"],
      ["outer", "table"],
    ]);
  });

  it("does not let a nested handler's account settle its parent's item", () => {
    const recorder = createReportRecorder();
    recorder.handle("table", "table", () => {
      // The cell's handler reports its own paragraph; the table still needs
      // an outcome of its own.
      recorder.handle("paragraph", "paragraph", () => {
        recorder.reporter.kept("paragraph");
        return "cell paragraph";
      }, always);
      return "built";
    }, always);
    const { counts } = recorder.snapshot();
    expect(counts["table"]?.kept).toBe(1);
    expect(counts["paragraph"]?.kept).toBe(1);
  });

  it("attributes a hook's calls without recording an outcome for it", () => {
    const recorder = createReportRecorder();
    recorder.attribute("headerFooter", () => {
      recorder.reporter.dropped("header", "first-page header has no slot");
    });
    expect(recorder.snapshot()).toEqual({
      counts: { header: { kept: 0, dropped: 1, changed: 0 } },
      entries: [
        {
          outcome: "dropped",
          kind: "header",
          reason: "first-page header has no slot",
          owner: "headerFooter",
          count: 1,
        },
      ],
    });
  });

  it("keeps an awaited hook's frame open across its awaits", async () => {
    const recorder = createReportRecorder();
    await recorder.attributeAsync("sections", async () => {
      await Promise.resolve();
      recorder.reporter.changed("section", "after an await");
    });
    recorder.reporter.changed("section", "after the hook");
    expect(recorder.snapshot().entries.map((e) => e.owner)).toEqual(["sections", null]);
  });

  it("closes a frame when its handler throws", () => {
    const recorder = createReportRecorder();
    expect(() =>
      recorder.handle("table", "table", () => {
        throw new Error("boom");
      }, always),
    ).toThrow("boom");
    recorder.reporter.changed("paragraph", "after the throw");
    expect(recorder.snapshot().entries[0]?.owner).toBeNull();
  });

  it("records the converter's own drops with no owner, even inside a handler", () => {
    const recorder = createReportRecorder();
    recorder.handle("headerFooter", "header", () => {
      recorder.unhandled("w:customXml", "no parser");
      return "built";
    }, always);
    expect(recorder.snapshot().entries).toEqual([
      { outcome: "dropped", kind: "w:customXml", reason: "no parser", owner: null, count: 1 },
    ]);
  });

  it("does not let the converter's own count settle a handler's item", () => {
    const recorder = createReportRecorder();
    recorder.handle("paragraph", "paragraph", () => {
      recorder.carried("paragraph");
      return null;
    }, (built) => built !== null);
    expect(recorder.snapshot().counts["paragraph"]).toEqual({ kept: 1, dropped: 1, changed: 0 });
  });
});

describe("report recorder — content of a lost item", () => {
  it("moves what was counted kept inside a lost item to dropped, under its owner", () => {
    const recorder = createReportRecorder();
    recorder.subtree(() => {
      recorder.carried("text");
      recorder.carried("text");
      recorder.handle("callout", "callout", () => null, (built) => built !== null);
      return null;
    }, () => ({ kind: "callout", owner: "callout" }));

    const report = recorder.snapshot();
    expect(report.counts["text"]).toEqual({ kept: 0, dropped: 2, changed: 0 });
    expect(report.entries).toContainEqual({
      outcome: "dropped",
      kind: "text",
      reason: insideDropped("callout"),
      owner: "callout",
      count: 2,
    });
  });

  it("leaves the counts alone when the item survives", () => {
    const recorder = createReportRecorder();
    recorder.subtree(() => {
      recorder.carried("text");
      return "built";
    }, () => null);
    expect(recorder.snapshot().counts["text"]).toEqual({ kept: 1, dropped: 0, changed: 0 });
  });

  it("lets an enclosing item take content that survived an inner one", () => {
    const recorder = createReportRecorder();
    recorder.subtree(() => {
      recorder.subtree(() => {
        recorder.carried("text");
        return "cell";
      }, () => null);
      return null;
    }, () => ({ kind: "table", owner: "table" }));

    expect(recorder.snapshot().counts["text"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
  });

  it("moves a handler's own kept count with its lost parent", () => {
    const recorder = createReportRecorder();
    recorder.subtree(() => {
      recorder.handle("list", "list", () => {
        recorder.reporter.kept("listItem", 3);
        return "list";
      }, always);
      return null;
    }, () => ({ kind: "sdt", owner: "sourcedBlock" }));

    const { counts } = recorder.snapshot();
    expect(counts["listItem"]).toEqual({ kept: 0, dropped: 3, changed: 0 });
    expect(counts["list"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
  });

  it("closes the subtree when its walk throws", () => {
    const recorder = createReportRecorder();
    expect(() =>
      recorder.subtree(() => {
        throw new Error("boom");
      }, () => ({ kind: "table", owner: "table" })),
    ).toThrow("boom");
    // With the subtree closed, a later lost item cannot reach this count.
    recorder.carried("text");
    recorder.subtree(() => "built", () => ({ kind: "paragraph", owner: null }));
    expect(recorder.snapshot().counts["text"]?.kept).toBe(1);
  });
});

describe("report recorder — entries", () => {
  it("merges identical drops into one entry with a count", () => {
    const recorder = createReportRecorder();
    for (let run = 0; run < 2000; run++) recorder.unhandled("lang", "no handler");
    recorder.unhandled("kern", "no handler");
    recorder.unhandled("lang", "no handler");

    const report = recorder.snapshot();
    expect(report.entries).toEqual([
      { outcome: "dropped", kind: "lang", reason: "no handler", owner: null, count: 2001 },
      { outcome: "dropped", kind: "kern", reason: "no handler", owner: null, count: 1 },
    ]);
    expect(report.counts["lang"]?.dropped).toBe(2001);
  });

  it("keeps drops apart when their owner or reason differs", () => {
    const recorder = createReportRecorder();
    recorder.unhandled("b", "no handler");
    recorder.handle("overrides", "b", () => null, (built) => built !== null);
    recorder.handle("null", "b", () => null, (built) => built !== null);
    expect(recorder.snapshot().entries.map((e) => [e.reason, e.owner])).toEqual([
      ["no handler", null],
      [HANDLER_RETURNED_NOTHING, "overrides"],
      [HANDLER_RETURNED_NOTHING, "null"],
    ]);
  });
});

describe("report recorder — counts", () => {
  it("ignores a count that is not a whole number of items, with a warning", () => {
    const warnings: Array<Omit<DocxDiagnostic, "level">> = [];
    const recorder = createReportRecorder({ warn: (d) => warnings.push(d) });
    recorder.handle("table", "table", () => {
      recorder.reporter.kept("row", 1.5);
      recorder.reporter.kept("row", -1);
      recorder.reporter.kept("table", Number.NaN);
      return "built";
    }, always);

    const { counts } = recorder.snapshot();
    expect(counts["row"]).toBeUndefined();
    // The bad count is no account, so the converter's own outcome stands.
    expect(counts["table"]?.kept).toBe(1);
    expect(warnings.map((w) => w.code)).toEqual([
      "report-invalid-count",
      "report-invalid-count",
      "report-invalid-count",
    ]);
  });

  it("keys counts in sorted order, whatever order they were met in", () => {
    const recorder = createReportRecorder();
    recorder.carried("text");
    recorder.carried("bold");
    recorder.unhandled("image", "x");
    expect(Object.keys(recorder.snapshot().counts)).toEqual(["bold", "image", "text"]);
  });

  it("keeps a kind named like an Object property as an ordinary key", () => {
    const recorder = createReportRecorder();
    recorder.unhandled("__proto__", "no parser");
    recorder.unhandled("constructor", "no parser");
    const { counts } = recorder.snapshot();
    expect(Object.keys(counts)).toEqual(["__proto__", "constructor"]);
    expect(Object.getPrototypeOf(counts)).toBe(Object.prototype);
  });

  it("hands out a snapshot the recorder no longer touches", () => {
    const recorder = createReportRecorder();
    recorder.unhandled("image", "x");
    const first = recorder.snapshot();
    first.entries[0]!.reason = "edited by the caller";
    first.counts["image"]!.dropped = 99;
    recorder.unhandled("image", "y");

    const second = recorder.snapshot();
    expect(second.counts["image"]?.dropped).toBe(2);
    expect(second.entries.map((e) => e.reason)).toEqual(["x", "y"]);
    expect(first.entries).toHaveLength(1);
  });
});

describe("report recorder — a handler's own account against its result", () => {
  it("keeps an item's content when its handler reports it kept but returns nothing", () => {
    // A handler that writes its item somewhere other than its result — a
    // footnote into its own part — has kept it, and so its content.
    const recorder = createReportRecorder();
    recorder.subtree(
      () => {
        recorder.carried("text");
        return recorder.handle(
          "footnote",
          "footnote",
          () => {
            recorder.reporter.kept("footnote");
            return null;
          },
          (result) => result !== null,
        );
      },
      (result) => (result === null ? { kind: "footnote", owner: "footnote" } : null),
    );

    const { counts, entries } = recorder.snapshot();
    expect(entries).toEqual([]);
    expect(counts["footnote"]).toEqual({ kept: 1, dropped: 0, changed: 0 });
    expect(counts["text"]).toEqual({ kept: 1, dropped: 0, changed: 0 });
  });

  it("still takes the content when the handler only reported a different kind kept", () => {
    const recorder = createReportRecorder();
    recorder.subtree(
      () => {
        recorder.carried("text");
        return recorder.handle(
          "callout",
          "callout",
          () => {
            recorder.reporter.kept("calloutIcon");
            return null;
          },
          (result) => result !== null,
        );
      },
      (result) => (result === null ? { kind: "callout", owner: "callout" } : null),
    );

    expect(recorder.snapshot().counts["text"]).toEqual({ kept: 0, dropped: 1, changed: 0 });
  });
});

describe("report recorder — binding", () => {
  it("binds the recorder its factory made, and warns once for a context it did not make", () => {
    const ctx = createDocxImportContext({ schema: new ServerEditor().schema });
    const bound = reportRecorderOf(ctx);
    expect(reportRecorderOf(ctx)).toBe(bound);
    expect(ctx.diagnostics.list().some((d) => d.code === "report-unbound")).toBe(false);

    // A copy is a different object, so the converter cannot find its recorder.
    const copy = { ...ctx };
    const detached = reportRecorderOf(copy);
    expect(detached).not.toBe(bound);
    expect(reportRecorderOf(copy)).toBe(detached);
    expect(ctx.diagnostics.list().filter((d) => d.code === "report-unbound")).toHaveLength(1);
  });
});

describe("handler ownership", () => {
  it("lets a later contribution replace a handler and its owner together", () => {
    const handlers: Record<string, string> = {};
    const owners: Record<string, HandlerOwner> = {};
    assignOwned(handlers, owners, { paragraph: "first", heading: "first" }, "paragraph");
    assignOwned(handlers, owners, { paragraph: "second" }, "overrides");
    assignOwned(handlers, owners, undefined, "nobody");

    expect(handlers).toEqual({ paragraph: "second", heading: "first" });
    expect(owners).toEqual({ paragraph: "overrides", heading: "paragraph" });
  });

  it("answers only for keys the table holds, not for Object's own", () => {
    const owners: Record<string, HandlerOwner> = { Heading1: "heading" };
    expect(ownerOf(owners, "Heading1")).toBe("heading");
    expect(ownerOf(owners, "constructor")).toBeNull();
    expect(ownerOf(owners, "toString")).toBeNull();
    expect(ownerOf(undefined, "Heading1")).toBeNull();

    const handlers: Record<string, () => string> = { Heading1: () => "heading" };
    expect(entryOf(handlers, "Heading1")).toBe(handlers["Heading1"]);
    expect(entryOf(handlers, "constructor")).toBeUndefined();
    expect(entryOf(handlers, "__proto__")).toBeUndefined();
  });

  it("orders bundles by registration, with the call's overrides last", () => {
    const contributions = [
      { extension: "paragraph", exports: {}, imports: {} },
      { extension: "noDocx", exports: {}, imports: {} },
      { extension: "bold", exports: {}, imports: {} },
    ];
    const bundles = ownedBundles(
      contributions,
      (c) => (c.extension === "noDocx" ? undefined : `${c.extension} bundle`),
      "override bundle",
    );
    expect(bundles).toEqual([
      { owner: "paragraph", bundle: "paragraph bundle" },
      { owner: "bold", bundle: "bold bundle" },
      { owner: "overrides", bundle: "override bundle" },
    ]);
  });
});
