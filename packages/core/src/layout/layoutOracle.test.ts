/**
 * One document has one layout, however it was arrived at: laid out whole,
 * streamed in chunks, after an edit, or again. What differs today for a reason
 * still to be fixed is in `knownDefects.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { Node } from "prosemirror-model";
import {
  differences, differencesFromWhole, doc, edit, EDITS, FLOATING, FLOWING, inTurn, p, recordLayout, SETUPS, streamed, whole, words, type Setup,
} from "../test/layoutOracle";
import { runMiniPipeline } from "./runMiniPipeline";
import { createMeasurer } from "../test-utils";
import { defaultPageConfig, runPipeline } from "./PageLayout";

const CHUNKS = [1, 2, 5];

const cases = (documents: Record<string, Node>): [string, string, Node, Setup][] =>
  Object.entries(SETUPS).flatMap(([setupName, setup]) =>
    Object.entries(documents).map(([name, node]): [string, string, Node, Setup] => [name, setupName, node, setup]),
  );

describe("a document streamed in chunks", () => {
  it.each(cases({ ...FLOWING, ...FLOATING }))("is the whole document's layout: %s, %s", (_name, _setup, node, setup) => {
    for (const blocks of CHUNKS) expect(differencesFromWhole(streamed(node, setup, blocks), node, setup)).toEqual([]);
  });
});

describe("a document laid out again", () => {
  it.each(cases({ ...FLOWING, ...FLOATING }))("is the whole document's layout: %s, %s", (_name, _setup, node, setup) => {
    expect(differencesFromWhole(inTurn([node, node, node], setup), node, setup)).toEqual([]);
  });
});

describe("a document after an edit", () => {
  it.each(cases({ ...FLOWING, ...FLOATING }))("is the whole document's layout: %s, %s", (_name, _setup, node, setup) => {
    for (const [change, apply] of Object.entries(EDITS)) {
      const edited = edit(node, apply);
      expect({ change, differences: differencesFromWhole(inTurn([node, edited], setup), edited, setup) }).toEqual({ change, differences: [] });
      const undone = differencesFromWhole(inTurn([node, edited, node], setup), node, setup);
      expect({ undone: change, differences: undone }).toEqual({ undone: change, differences: [] });
    }
  });

  it.each(cases({ ...FLOWING, ...FLOATING }))("is the whole document's layout after every edit in turn: %s, %s", (_name, _setup, node, setup) => {
    const history = Object.values(EDITS).reduce<Node[]>((nodes, apply) => [...nodes, edit(nodes.at(-1) ?? node, apply)], [node]);
    const last = history.at(-1) ?? node;
    expect(differencesFromWhole(inTurn(history, setup), last, setup)).toEqual([]);
  });
});

describe("a streamed document after an edit", () => {
  it.each(cases({ ...FLOWING, ...FLOATING }))("is the whole document's layout: %s, %s", (_name, _setup, node, setup) => {
    for (const [change, apply] of Object.entries(EDITS)) {
      const edited = edit(node, apply);
      const differences = differencesFromWhole(inTurn([node, edited], setup, 2), edited, setup);
      expect({ change, differences }).toEqual({ change, differences: [] });
    }
  });
});

describe("a header or footer's own document", () => {
  it.each(Object.entries(FLOWING))("is laid out as the same document without pages: %s", (_name, node) => {
    const pageConfig = { ...defaultPageConfig, pageless: true };
    const options = { pageConfig, measurer: createMeasurer() };
    const mini = runMiniPipeline(node, options);
    const pageless = runPipeline(node, options);
    expect(differences(mini.pages.map(pageOf), pageless.pages.map(pageOf))).toEqual([]);
    const contentTop = pageless.metrics?.[0]?.contentTop ?? 0;
    expect(differences(mini.totalContentHeight, pageless.totalContentHeight - contentTop - pageConfig.margins.bottom)).toEqual([]);
  });
});

const pageOf = (page: ReturnType<typeof runPipeline>["pages"][number]) =>
  page.blocks.map((block) => ({ nodePos: block.nodePos, x: block.x, y: block.y, height: block.height, lines: block.lines.map((line) => line.spans.map((span) => [span.docPos, span.x])) }));

describe("the pages before the last one", () => {
  /** What is painted on a page: text and blocks, not the space lines reserve. */
  const ink = (node: Node, setup: Setup) =>
    whole(node, setup).pages.map((page) =>
      page.blocks.map((block) => {
        let y = block.y;
        return [block.nodePos, block.x, block.lines.flatMap((line) => {
          const at = y;
          y += line.lineHeight;
          return line.spans.length > 0 ? [[at, line.spans.map((span) => [span.docPos, span.x])]] : [];
        })];
      }),
    );

  it.each(cases({ ...FLOWING, ...FLOATING }).filter(([, setupName]) => setupName !== "no pages"))(
    "do not change with what follows: %s, %s",
    (_name, _setup, node, setup) => {
      const full = ink(node, setup);
      for (let count = 1; count < node.childCount; count++) {
        const start = ink(doc(...Array.from({ length: count }, (_, i) => node.child(i))), setup);
        expect({ count, differences: differences(start.slice(0, -1), full.slice(0, start.length - 1)) }).toEqual({ count, differences: [] });
      }
    },
  );
});

describe("the comparison itself", () => {
  const node = doc(p("one"), p("two"));
  const setup: Setup = { pageConfig: defaultPageConfig };
  const record = (n: Node) => recordLayout(whole(n, setup), n.content.size);

  it("finds a moved block, a changed word and a missing paragraph", () => {
    expect(differences(record(doc(p("one"), p(), p("two"))), record(node))).not.toEqual([]);
    expect(differences(record(doc(p("one"), p("too"))), record(node))).not.toEqual([]);
    expect(differences(record(doc(p("one"))), record(node))).not.toEqual([]);
  });

  it("takes two sums of the same numbers as the same position", () => {
    expect(differences(0.1 + 0.2, 0.3)).toEqual([]);
    expect(differences(0.3001, 0.3)).not.toEqual([]);
  });
});
