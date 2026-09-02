import { describe, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { LayoutCoordinator } from "./LayoutCoordinator";
import {
  collectLayoutItems,
  buildBlockFlow,
  runPipeline,
  paginateFlow,
  assignGlobalY,
  buildFragments,
  defaultPageConfig,
  type DocumentLayout,
  type MeasureCacheEntry,
} from "./PageLayout";
import {
  createPageGeometry,
  EMPTY_RESOLVED_CHROME,
  type PageGeometry,
  type PageMetrics,
} from "./PageMetrics";
import { applyPageFont } from "./FontConfig";
import { getSchema } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { createMeasurer } from "../test-utils";

/**
 * Not an assertion suite — a stopwatch for issue #161.
 *
 * Reports the cost of one interaction against a fully laid-out document, as a
 * function of document size, so the linear terms in the pipeline show up as
 * numbers rather than as a reading of the code.
 */

const schema = getSchema([StarterKit]);
const measurer = createMeasurer();
const fontConfig = applyPageFont(
  new ExtensionManager([StarterKit]).buildBlockStyles(),
  "Arial, sans-serif",
);

const BODY =
  "The quick brown fox jumps over the lazy dog, repeatedly and at some length, so that this paragraph wraps across more than a single rendered line.";

/** Samples per measurement. Enough to shake off GC without slowing the sweep. */
const SAMPLES = 11;

function buildDoc(blocks: number): Node {
  const paras: Node[] = [];
  for (let i = 0; i < blocks; i++) {
    paras.push(schema.node("paragraph", null, [schema.text(`Block ${i}. ${BODY}`)]));
  }
  return schema.node("doc", null, paras);
}

function insertCharAt(doc: Node, pos: number): Node {
  const state = EditorState.create({ doc, schema });
  const tr = state.tr.insertText("x", pos);
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  return tr.doc;
}

/** Median of repeated samples — resistant to GC spikes. */
function median(run: () => void, samples: number): number {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t = performance.now();
    run();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1]!;
}

function countLines(layout: DocumentLayout): number {
  let n = 0;
  for (const page of layout.pages) {
    for (const block of page.blocks) {
      n += block.kind === "leaf" ? 1 : block.lines.length;
    }
  }
  return n;
}

interface Row {
  blocks: number;
  pages: number;
  lines: number;
  fullLayoutMs: number;
  selectionOnlyMs: number;
  typeStartMs: number;
  typeMidMs: number;
  typeEndMs: number;
  collectMs: number;
  flowColdMs: number;
  flowWarmMs: number;
  pipelineWarmMs: number;
  rangePopulateMs: number;
}

function trace(blocks: number): Row {
  let doc = buildDoc(blocks);
  let head = 5;

  const lc = new LayoutCoordinator({
    pageConfig: defaultPageConfig,
    fontConfig,
    measurer,
    fontModifiers: new Map(),
    getDoc: () => doc,
    getHead: () => head,
    onUpdate: () => {},
  });

  // "After the full document has rendered" — the state issue #161 describes.
  // Also cancels the constructor's pending idle-layout timer.
  const fullLayoutMs = median(() => lc.ensureFullLayout(), 3);
  const layout = lc.current;

  // A pure caret move: no document change at all, but viewDispatch still
  // invalidates, so the next frame runs the whole pipeline.
  const selectionOnlyMs = median(() => {
    head = head === 5 ? 6 : 5;
    lc.invalidate();
    lc.ensureLayout();
  }, SAMPLES);

  const typeStartMs = median(() => {
    doc = insertCharAt(doc, 5);
    head = 6;
    lc.invalidate();
    lc.ensureLayout();
  }, SAMPLES);

  const typeMidMs = median(() => {
    const pos = Math.floor(doc.content.size / 2);
    doc = insertCharAt(doc, pos);
    head = pos + 1;
    lc.invalidate();
    lc.ensureLayout();
  }, SAMPLES);

  const typeEndMs = median(() => {
    const pos = doc.content.size - 2;
    doc = insertCharAt(doc, pos);
    head = pos + 1;
    lc.invalidate();
    lc.ensureLayout();
  }, SAMPLES);

  // Selection hit-testing path: pagesTouchingRange scans fragmentIndex linearly.
  const rangePopulateMs = median(
    () => void lc.ensureRangePopulated(5, Math.floor(doc.content.size / 2)),
    SAMPLES,
  );

  // ── Stage attribution against the final document ──────────────────────────
  const collectMs = median(() => void collectLayoutItems(doc, fontConfig), SAMPLES);
  const items = collectLayoutItems(doc, fontConfig);
  const flowConfig = {
    margins: defaultPageConfig.margins,
    contentWidth:
      defaultPageConfig.pageWidth -
      defaultPageConfig.margins.left -
      defaultPageConfig.margins.right,
  };

  const runFlow = (cache: WeakMap<Node, MeasureCacheEntry>) =>
    buildBlockFlow(items, 0, flowConfig, fontConfig, measurer, new Map(), cache);

  // Cold: nothing reusable. Warm: every block a measure-cache hit — the steady
  // state an unchanged keystroke actually sees.
  const flowColdMs = median(() => void runFlow(new WeakMap()), 3);
  const warmCache = new WeakMap<Node, MeasureCacheEntry>();
  runFlow(warmCache);
  const flowWarmMs = median(() => void runFlow(warmCache), SAMPLES);

  // Full pipeline, warm, with a reusable previous layout — everything
  // ensureLayout() does except indexLayout() and the CharacterMap work.
  const pipelineCache = new WeakMap<Node, MeasureCacheEntry>();
  const seed = runPipeline(doc, {
    pageConfig: defaultPageConfig,
    fontConfig,
    measurer,
    fontModifiers: new Map(),
    measureCache: pipelineCache,
  });
  const pipelineWarmMs = median(
    () =>
      void runPipeline(doc, {
        pageConfig: defaultPageConfig,
        fontConfig,
        measurer,
        fontModifiers: new Map(),
        measureCache: pipelineCache,
        previousLayout: seed,
        previousVersion: seed.version,
      }),
    SAMPLES,
  );

  lc.destroy();

  return {
    blocks,
    pages: layout.pages.length,
    lines: countLines(layout),
    fullLayoutMs,
    selectionOnlyMs,
    typeStartMs,
    typeMidMs,
    typeEndMs,
    collectMs,
    flowColdMs,
    flowWarmMs,
    pipelineWarmMs,
    rangePopulateMs,
  };
}

/**
 * Pressure test for the pagination layer.
 *
 * `paginateFlow` takes `metricsFor` as a parameter, so counting its calls
 * against a known page count says directly whether Stage 2 is linear in the
 * document or quadratic in it.
 */
function pressurePagination(blocks: number): {
  blocks: number;
  pages: number;
  metricsForCalls: number;
  computeCalls: number;
  callsPerBlock: number;
  paginateMs: number;
  globalYCalls: number;
  globalYMs: number;
  fragmentsMs: number;
} {
  const doc = buildDoc(blocks);
  const items = collectLayoutItems(doc, fontConfig);
  const flowConfig = {
    margins: defaultPageConfig.margins,
    contentWidth:
      defaultPageConfig.pageWidth -
      defaultPageConfig.margins.left -
      defaultPageConfig.margins.right,
  };
  const cache = new WeakMap<Node, MeasureCacheEntry>();
  const { flows } = buildBlockFlow(
    items,
    0,
    flowConfig,
    fontConfig,
    measurer,
    new Map(),
    cache,
  );

  let metricsForCalls = 0;
  let computeCalls = 0;
  const inner = createPageGeometry(defaultPageConfig, EMPTY_RESOLVED_CHROME);
  const count = <T,>(fn: () => T): T => {
    metricsForCalls++;
    return fn();
  };
  const geometry: PageGeometry = {
    metricsFor: (p) => count(() => inner.metricsFor(p)),
    startOf: (p) => count(() => inner.startOf(p)),
    bottomOf: (p) => count(() => inner.bottomOf(p)),
    pageAt: (y) => count(() => inner.pageAt(y)),
  };

  const freshInit = () => ({
    pages: [],
    page: { pageNumber: 1, blocks: [] },
    y: geometry.metricsFor(1).contentTop,
    prevSpaceAfter: 0,
  });

  const result = paginateFlow(
    flows,
    defaultPageConfig,
    EMPTY_RESOLVED_CHROME,
    geometry,
    1,
    { measureCache: cache, measurer, init: freshInit() },
  );
  const pages = result.pages.length + 1;

  metricsForCalls = 0;
  const paginateMs = median(() => {
    void paginateFlow(flows, defaultPageConfig, EMPTY_RESOLVED_CHROME, geometry, 1, {
      measureCache: cache,
      measurer,
      init: freshInit(),
    });
  }, 3);
  metricsForCalls = Math.round(metricsForCalls / 3);

  // Stage 2a — the step paginateFlow's numbers do not cover.
  const paginateCalls = metricsForCalls;
  const seedY = geometry.metricsFor(1).contentTop;
  metricsForCalls = 0;
  // Counted and timed separately — a counting wrapper on a seven-figure call
  // count would dominate the timed run.
  assignGlobalY(flows, seedY, defaultPageConfig, geometry);
  const globalYCalls = metricsForCalls;
  const globalYMs = median(
    () => void assignGlobalY(flows, seedY, defaultPageConfig, inner),
    3,
  );

  const laidOut = assignGlobalY(flows, seedY, defaultPageConfig, inner);
  const paged = paginateFlow(
    laidOut,
    defaultPageConfig,
    EMPTY_RESOLVED_CHROME,
    inner,
    1,
    { measureCache: cache, measurer, init: freshInit() },
  );
  const allPages = [...paged.pages, paged.currentPage];
  const fragmentsMs = median(() => void buildFragments(allPages), 3);

  return {
    blocks,
    pages,
    metricsForCalls: paginateCalls,
    computeCalls,
    callsPerBlock: paginateCalls / blocks,
    paginateMs,
    globalYCalls,
    globalYMs,
    fragmentsMs,
  };
}

/**
 * One frame at 60fps. An interaction that costs more than this cannot paint
 * in the frame it was dispatched in.
 */
const FRAME_BUDGET_MS = 16.7;

describe("pipeline trace (issue #161)", () => {
  it(
    "sweeps document size to find where interaction leaves the frame budget",
    () => {
      // ~20 blocks per page: start at 2 pages, double until well past the
      // 200-page document the issue describes.
      const sizes = [40, 80, 160, 320, 640, 1280, 2560, 5120];
      const rows: Row[] = [];
      for (const n of sizes) rows.push(trace(n));

      const f = (v: number, w: number) => v.toFixed(2).padStart(w);
      const i = (v: number, w: number) => String(v).padStart(w);

      console.log(
        "\n  ── interaction cost (ms, median) ─────────────────────────────────────────────────────────────",
      );
      console.log(
        " blocks  pages  lines |    full  sel-only   type@0  type@mid  type@end | range-pop",
      );
      console.log(
        " ------  -----  ----- |  ------  --------  -------  --------  -------- | ---------",
      );
      for (const r of rows) {
        console.log(
          `${i(r.blocks, 7)}${i(r.pages, 7)}${i(r.lines, 7)} |${f(r.fullLayoutMs, 8)}${f(r.selectionOnlyMs, 10)}${f(r.typeStartMs, 9)}${f(r.typeMidMs, 10)}${f(r.typeEndMs, 10)} |${f(r.rangePopulateMs, 10)}`,
        );
      }

      console.log(
        "\n  ── stage attribution (ms, median) ────────────────────────────────────────────────────────────",
      );
      console.log(
        " blocks | collect  flow(cold)  flow(warm)  pipeline(warm)  ensureLayout | coordinator overhead",
      );
      console.log(
        " ------ | -------  ----------  ----------  --------------  ------------ | --------------------",
      );
      for (const r of rows) {
        const overhead = r.selectionOnlyMs - r.pipelineWarmMs;
        const pct = (overhead / Math.max(r.selectionOnlyMs, 0.001)) * 100;
        console.log(
          `${i(r.blocks, 7)} |${f(r.collectMs, 8)}${f(r.flowColdMs, 12)}${f(r.flowWarmMs, 12)}${f(r.pipelineWarmMs, 16)}${f(r.selectionOnlyMs, 14)} |${f(overhead, 10)}  (${pct.toFixed(0)}%)`,
        );
      }

      // Where does each interaction cross one frame?
      const threshold = (pick: (r: Row) => number, label: string) => {
        const hit = rows.find((r) => pick(r) > FRAME_BUDGET_MS);
        console.log(
          hit
            ? `  ${label.padEnd(12)} exceeds ${FRAME_BUDGET_MS}ms at ${hit.blocks} blocks / ${hit.pages} pages (${pick(hit).toFixed(1)}ms)`
            : `  ${label.padEnd(12)} stays within budget through ${rows.at(-1)!.pages} pages`,
        );
      };
      console.log(`\n  ── frame-budget thresholds (${FRAME_BUDGET_MS}ms) ──`);
      threshold((r) => r.selectionOnlyMs, "caret move");
      threshold((r) => r.typeStartMs, "type@0");
      threshold((r) => r.typeMidMs, "type@mid");
      threshold((r) => r.typeEndMs, "type@end");
      threshold((r) => r.rangePopulateMs, "range-pop");

      // Scaling exponent: 1.0 = linear in document size, 2.0 = quadratic.
      const exponent = (pick: (r: Row) => number) => {
        const a = rows[0]!;
        const b = rows.at(-1)!;
        return (
          Math.log(pick(b) / Math.max(pick(a), 0.001)) /
          Math.log(b.blocks / a.blocks)
        );
      };
      console.log(`\n  ── scaling exponent (1.0 = linear, 2.0 = quadratic) ──`);
      for (const [label, pick] of [
        ["caret move", (r: Row) => r.selectionOnlyMs],
        ["type@0", (r: Row) => r.typeStartMs],
        ["type@end", (r: Row) => r.typeEndMs],
        ["flow(warm)", (r: Row) => r.flowWarmMs],
        ["range-pop", (r: Row) => r.rangePopulateMs],
      ] as const) {
        console.log(`  ${label.padEnd(12)} ${exponent(pick).toFixed(2)}`);
      }
      console.log("");
    },
    900_000,
  );

  it(
    "pressures the pagination layer — metricsFor call count vs document size",
    () => {
      const rows = [40, 80, 160, 320, 640, 1280, 2560].map(pressurePagination);

      console.log(
        "\n  ── Stage 2 breakdown: metricsFor calls + time per stage ──────────────────────────────",
      );
      console.log(
        " blocks  pages | paginate calls  paginate ms | assignGlobalY calls  calls/block  globalY ms | fragments ms",
      );
      console.log(
        " ------  ----- | --------------  -----------  -------------------  -----------  ----------  ------------",
      );
      for (const r of rows) {
        console.log(
          `${String(r.blocks).padStart(7)}${String(r.pages).padStart(7)} |` +
            `${r.metricsForCalls.toLocaleString().padStart(16)}` +
            `${r.paginateMs.toFixed(2).padStart(13)} |` +
            `${r.globalYCalls.toLocaleString().padStart(21)}` +
            `${(r.globalYCalls / r.blocks).toFixed(0).padStart(13)}` +
            `${r.globalYMs.toFixed(2).padStart(12)} |` +
            `${r.fragmentsMs.toFixed(2).padStart(13)}`,
        );
      }

      const a = rows[0]!;
      const b = rows.at(-1)!;
      const exp = (x: number, y: number) =>
        Math.log(y / Math.max(x, 0.001)) / Math.log(b.blocks / a.blocks);
      console.log(`\n  ── scaling exponent (1.0 linear, 2.0 quadratic, 3.0 cubic) ──`);
      console.log(
        `  paginate calls      ${exp(a.metricsForCalls, b.metricsForCalls).toFixed(2)}\n` +
          `  paginate time       ${exp(a.paginateMs, b.paginateMs).toFixed(2)}\n` +
          `  assignGlobalY calls ${exp(a.globalYCalls, b.globalYCalls).toFixed(2)}   <-- metricsFor calls in Stage 2a\n` +
          `  assignGlobalY time  ${exp(a.globalYMs, b.globalYMs).toFixed(2)}\n` +
          `  buildFragments time ${exp(a.fragmentsMs, b.fragmentsMs).toFixed(2)}`,
      );

      console.log("");
    },
    900_000,
  );
});
