/**
 * Pair two lists in order by a key — their longest common subsequence — so an
 * item one side lost or gained does not shift every pair after it. Returns
 * index pairs `[i, j]` with `key(a[i]) === key(b[j])`, increasing in both.
 */
export function alignInOrder<T>(a: readonly T[], b: readonly T[], key: (item: T) => string): Array<[number, number]> {
  const ka = a.map(key);
  const kb = b.map(key);
  // lengths[i][j]: the longest common subsequence of ka[i..] and kb[j..].
  const lengths = Array.from({ length: ka.length + 1 }, () => new Uint32Array(kb.length + 1));
  for (let i = ka.length - 1; i >= 0; i--) {
    const row = lengths[i]!;
    const below = lengths[i + 1]!;
    for (let j = kb.length - 1; j >= 0; j--) {
      row[j] = ka[i] === kb[j] ? below[j + 1]! + 1 : Math.max(below[j]!, row[j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < ka.length && j < kb.length) {
    if (ka[i] === kb[j]) pairs.push([i++, j++]);
    else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}
