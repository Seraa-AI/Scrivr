/**
 * CursorManager — owns cursor blink timing.
 *
 * Lives on the Editor, not in any UI framework component.
 * This means blink logic is framework-agnostic and testable in isolation.
 *
 * Responsibilities:
 *   - Toggle isVisible on a fixed interval (530ms matches Windows/Chrome)
 *   - Fire onTick so the overlay canvas knows to redraw
 *   - reset() — called on every keystroke/click so the cursor always shows
 *     immediately and the timer restarts from that point.
 *     Without reset(), typing while the cursor is in the "off" phase makes
 *     it feel like keystrokes are being dropped.
 *
 * Usage:
 *   const cursor = new CursorManager(() => redrawOverlay());
 *   cursor.start();
 *   // On any user interaction:
 *   cursor.reset();
 *   // On blur / editor destroy:
 *   cursor.stop();
 */
export class CursorManager {
  private _isVisible = true;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private readonly onTick: () => void;

  static readonly BLINK_INTERVAL_MS = 530;

  constructor(onTick: () => void) {
    this.onTick = onTick;
  }

  /** Start blinking. Safe to call multiple times — clears any existing timer. */
  start(): void {
    this.stop();
    this._isVisible = true;
    this.timerId = setInterval(() => {
      this._isVisible = !this._isVisible;
      this.onTick();
    }, CursorManager.BLINK_INTERVAL_MS);
  }

  /** Stop blinking and clear the timer. */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Reset the blink cycle.
   *
   * Call on every keystroke, click, or any user interaction that moves
   * the cursor. Ensures the cursor is immediately visible and the 530ms
   * timer restarts from this moment.
   */
  reset(): void {
    this._isVisible = true;
    this.start();
    this.onTick();
  }

  /** Whether the cursor should be drawn on the current tick. */
  get isVisible(): boolean {
    return this._isVisible;
  }
}
