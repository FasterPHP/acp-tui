// Seeded pseudo-random numbers (mulberry32) so scenario content is the same on
// every run and on every machine: a benchmark or golden file that depends on a
// scenario's output can then be compared across runs.
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks one element, deterministically for a given rng state. */
export function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)] as T;
}

/** Integer in [min, max], inclusive. */
export function between(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
