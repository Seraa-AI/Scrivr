/**
 * Vitest setup for @inscribe/core — runs before each test file.
 * Overrides HTMLCanvasElement.measureText with deterministic values so
 * TextMeasurer returns predictable pixel sizes in every layout test.
 */
import { mockCanvas } from "./src/test-utils";

mockCanvas();
