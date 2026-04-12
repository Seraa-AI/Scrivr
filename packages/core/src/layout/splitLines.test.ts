import { describe, it, expect } from "vitest";
import { fitLinesInCapacity } from "./splitLines";
import type { LayoutLine } from "./LineBreaker";

/**
 * Minimal LayoutLine factory — `fitLinesInCapacity` only reads `lineHeight`,
 * so the other fields can be stubbed with safe defaults without affecting
 * behavior. All required fields on the interface are present so the factory
 * passes tsc strict checks.
 */
function line(lineHeight: number): LayoutLine {
  return {
    spans: [],
    width: 0,
    ascent: lineHeight,
    descent: 0,
    lineHeight,
    textAscent: lineHeight,
    cursorHeight: lineHeight,
    xHeight: lineHeight * 0.5,
  };
}

describe("fitLinesInCapacity", () => {
  describe("edge cases", () => {
    it("empty lines → empty fitted, empty rest, 0 height", () => {
      const result = fitLinesInCapacity([], 100);
      expect(result.fitted).toEqual([]);
      expect(result.rest).toEqual([]);
      expect(result.fittedHeight).toBe(0);
    });

    it("capacity=0 → nothing fits, all lines in rest", () => {
      const lines = [line(10), line(20), line(15)];
      const result = fitLinesInCapacity(lines, 0);
      expect(result.fitted).toEqual([]);
      expect(result.rest).toBe(lines); // same reference — no slicing on this path
      expect(result.fittedHeight).toBe(0);
    });

    it("capacity<0 → treated same as capacity=0", () => {
      const lines = [line(10)];
      const result = fitLinesInCapacity(lines, -5);
      expect(result.fitted).toEqual([]);
      expect(result.rest).toBe(lines);
      expect(result.fittedHeight).toBe(0);
    });

    it("first line larger than capacity → zero fit", () => {
      const lines = [line(50), line(10), line(10)];
      const result = fitLinesInCapacity(lines, 30);
      expect(result.fitted).toEqual([]);
      expect(result.rest).toHaveLength(3);
      expect(result.fittedHeight).toBe(0);
    });
  });

  describe("fitting logic", () => {
    it("all lines fit when capacity is larger than total", () => {
      const lines = [line(10), line(20), line(15)];
      const result = fitLinesInCapacity(lines, 100);
      expect(result.fitted).toHaveLength(3);
      expect(result.rest).toEqual([]);
      expect(result.fittedHeight).toBe(45);
    });

    it("capacity exactly matches total height → all fit, empty rest", () => {
      const lines = [line(10), line(20), line(15)];
      const result = fitLinesInCapacity(lines, 45);
      expect(result.fitted).toHaveLength(3);
      expect(result.rest).toEqual([]);
      expect(result.fittedHeight).toBe(45);
    });

    it("partial fit at a boundary — stops at first line that overflows", () => {
      const lines = [line(10), line(20), line(15), line(5)];
      const result = fitLinesInCapacity(lines, 35);
      // 10 + 20 = 30, next is 15 → 30 + 15 = 45 > 35, stop at index 2
      expect(result.fitted).toHaveLength(2);
      expect(result.rest).toHaveLength(2);
      expect(result.fittedHeight).toBe(30);
    });

    it("capacity 1px less than a fit → excludes the last line", () => {
      const lines = [line(10), line(20)];
      const result = fitLinesInCapacity(lines, 29);
      expect(result.fitted).toHaveLength(1);
      expect(result.rest).toHaveLength(1);
      expect(result.fittedHeight).toBe(10);
    });

    it("single line exactly matching capacity → fits", () => {
      const lines = [line(25)];
      const result = fitLinesInCapacity(lines, 25);
      expect(result.fitted).toHaveLength(1);
      expect(result.rest).toEqual([]);
      expect(result.fittedHeight).toBe(25);
    });
  });

  describe("purity", () => {
    it("does not mutate the input array", () => {
      const lines = [line(10), line(20), line(30)];
      const snapshot = [...lines];
      fitLinesInCapacity(lines, 25);
      expect(lines).toEqual(snapshot);
    });

    it("returns new arrays for fitted and rest on partial fits", () => {
      const lines = [line(10), line(20)];
      const result = fitLinesInCapacity(lines, 15);
      expect(result.fitted).not.toBe(lines);
      expect(result.rest).not.toBe(lines);
    });

    it("deterministic — same input produces same output", () => {
      const lines = [line(10), line(20), line(15)];
      const a = fitLinesInCapacity(lines, 35);
      const b = fitLinesInCapacity(lines, 35);
      expect(a.fitted).toEqual(b.fitted);
      expect(a.rest).toEqual(b.rest);
      expect(a.fittedHeight).toBe(b.fittedHeight);
    });
  });
});
