/**
 * FNV-1a 32-bit string hash, returned as 8 hex chars. Non-cryptographic —
 * cheap, synchronous, and collision-resistant enough for change-detection
 * ("did this content change between two versions?"), not tamper-evidence.
 *
 * Deterministic: the same input always produces the same hash. Shared by the
 * document fingerprint (`normalizeDocument`) and the semantic lane's per-unit
 * content hash so both sides agree on the algorithm.
 */
export function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Stable stringify — object keys emitted in sorted order so two structurally
 * equal values always produce identical strings regardless of key insertion
 * order. Pair with `fnv1aHex` for order-independent content hashes (document
 * fingerprint, per-unit hashes).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
