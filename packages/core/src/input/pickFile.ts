/**
 * Ask the user for one file of the `accept` types (an `<input accept>` list).
 *
 * Returns the picked file, or `undefined` if the user cancelled. The hidden
 * `<input>` is removed once the pick settles, on `change` (chosen) or `cancel`
 * (Chrome 113+, Firefox 109+, Safari 16.4+).
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
        // Without `cancel`, the window regaining focus is the only sign the
        // dialog closed — and `change` can land just after it, so wait
        // before treating the focus as a cancel.
        setTimeout(() => settle(undefined), 300);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}
