/**
 * Ask the user for one file of the `accept` types (an `<input accept>` list).
 *
 * Returns the picked file, or `undefined` if the user cancelled. Uses a
 * detached `<input>` so we don't leak DOM, and resolves on `change` (chosen)
 * or `cancel` (modern browsers — Chrome 113+, Firefox 109+, Safari 16.4+).
 *
 * Older browsers don't fire `cancel`, so the promise stays pending until
 * focus returns and we time out the listener (one tick after window focus).
 */
export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";

    let settled = false;
    const settle = (file: File | undefined) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      settle(file);
    });
    input.addEventListener("cancel", () => settle(undefined));

    // Focus-based fallback for browsers without the `cancel` event.
    window.addEventListener(
      "focus",
      () => {
        // The change event fires before focus returns when a file is
        // chosen, so a focus event without a settled promise means the
        // dialog was dismissed.
        setTimeout(() => settle(undefined), 300);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}
