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
