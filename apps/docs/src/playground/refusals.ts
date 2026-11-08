import type { TrackingRefusal } from "@scrivr/plugins";

type Listener = (refusal: TrackingRefusal) => void;

const listeners = new Set<Listener>();

/** Passed to `TrackChanges.configure({ onRefused })`: the extension is built before React mounts. */
export const reportRefusal = (refusal: TrackingRefusal) => listeners.forEach((listener) => listener(refusal));

export function onRefusal(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
