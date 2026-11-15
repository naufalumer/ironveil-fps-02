// One seeded generator for everything the game randomises — bot choices,
// spread, respawn jitter — so a capture run with ?seed=N is reproducible
// while a live game still varies. mulberry32: small, fast, good enough
// for a game.
export function seededRng(seedValue) {
  let state = seedValue | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mix = state;
    mix = Math.imul(mix ^ (mix >>> 15), mix | 1);
    mix = (mix + Math.imul(mix ^ (mix >>> 7), mix | 61)) ^ mix;
    return ((mix ^ (mix >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates over the game's own generator, in place, no allocation.
export function shuffleInPlace(items, rand) {
  let i = items.length;
  while (i > 1) {
    i -= 1;
    const j = Math.floor(rand() * (i + 1));
    const held = items[i];
    items[i] = items[j];
    items[j] = held;
  }
  return items;
}
