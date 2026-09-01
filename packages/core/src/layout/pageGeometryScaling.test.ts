import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import {
  assignGlobalY,
  buildBlockFlow,
  collectLayoutItems,
  defaultPageConfig,
  type MeasureCacheEntry,
} from "./PageLayout";
import {
  createPageGeometry,
  EMPTY_RESOLVED_CHROME,
  type PageGeometry,
} from "./PageMetrics";
import { applyPageFont } from "./FontConfig";
import { getSchema, ExtensionManager } from "./../extensions/ExtensionManager";
import { StarterKit } from "./../extensions/StarterKit";
import { createMeasurer } from "../test-utils";

/**
 * Page geometry must not be rediscovered per block.
 *
 * `assignGlobalY` walks every block and asks which page each one lands on.
 * When that question costs a scan over the pages before it, the stage is
 * quadratic in page count and the whole layout pass goes cubic in document
 * size — a caret move on a 250-page document cost ~1s (issue #161).
 *
 * These tests pin the shape rather than a wall-clock number: they count the
 * page-metric lookups the stage performs, which is deterministic and immune
 * to CI machine speed and font drift.
 */

const schema = getSchema([StarterKit]);
const measurer = createMeasurer();
const fontConfig = applyPageFont(
  new ExtensionManager([StarterKit]).buildBlockStyles(),
  "Arial, sans-serif",
);

const BODY =
  "The quick brown fox jumps over the lazy dog, repeatedly and at some length, so that this paragraph wraps across more than a single rendered line.";

function buildDoc(blocks: number): Node {
  const paras: Node[] = [];
  for (let i = 0; i < blocks; i++) {
    paras.push(schema.node("paragraph", null, [schema.text(`Block ${i}. ${BODY}`)]));
  }
  return schema.node("doc", null, paras);
}

/** Number of page-metric lookups `assignGlobalY` performs for a document. */
function metricLookups(blocks: number): { calls: number; perBlock: number } {
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

  // Count every page-geometry question the stage asks, whatever form it takes —
  // a metrics read, a page start, a page-for-Y lookup. Counting the queries
  // rather than one helper keeps the guard honest across future rewrites.
  const inner = createPageGeometry(defaultPageConfig, EMPTY_RESOLVED_CHROME);
  let calls = 0;
  const geometry: PageGeometry = {
    metricsFor: (p) => {
      calls++;
      return inner.metricsFor(p);
    },
    startOf: (p) => {
      calls++;
      return inner.startOf(p);
    },
    bottomOf: (p) => {
      calls++;
      return inner.bottomOf(p);
    },
    pageAt: (y) => {
      calls++;
      return inner.pageAt(y);
    },
  };

  const seedY = geometry.metricsFor(1).contentTop;
  calls = 0;
  assignGlobalY(flows, seedY, defaultPageConfig, geometry);
  return { calls, perBlock: calls / blocks };
}

describe("assignGlobalY page-geometry lookups", () => {
  /**
   * Locating a block's page must not depend on how many pages precede it.
   * A constant ceiling per block is what separates a linear stage from a
   * quadratic one; the value is loose enough to absorb the handful of probes
   * a block that straddles a page boundary legitimately needs.
   */
  it("performs a bounded number of lookups per block, independent of page count", () => {
    const small = metricLookups(160); // ~8 pages
    const large = metricLookups(2560); // ~125 pages

    expect(small.perBlock).toBeLessThan(20);
    expect(large.perBlock).toBeLessThan(20);
  });

  it("scales linearly with document size, not quadratically", () => {
    const a = metricLookups(320); // ~16 pages
    const b = metricLookups(2560); // ~125 pages

    // 8x the document must not cost dramatically more than 8x the lookups.
    const exponent = Math.log(b.calls / a.calls) / Math.log(2560 / 320);
    expect(exponent).toBeLessThan(1.2);
  });
});
