// Every colour the game uses, in one table: a night foundry — cold
// blue-grey steel and concrete, molten orange from the furnace and the
// lamps, green painted steel, pale bone for shapes the player must read
// at a glance. The names here mirror the CSS custom properties in
// index.html, so the page and the scene agree on the look.
const SWATCHES = [
  ['abyss', '#0d1117'], // page background, fog, deep shadow
  ['haze', '#232c3a'], // sky bounce from the hemisphere light
  ['slab', '#333a42'], // foundry floor
  ['bulkhead', '#414b55'], // perimeter walls and the furnace hall
  ['column', '#4d5865'], // pillars
  ['girder', '#5d6b7a'], // gantry steel and lamp poles
  ['timber', '#6e5b3f'], // wooden crates
  ['rust', '#7a3d22'], // scorched ingot stacks
  ['moss', '#2e6b52'], // green painted steel, cool fill light
  ['molten', '#ff7a1a'], // accent: furnace glow, site rings, HUD marks
  ['stripe', '#4a545f'], // painted lane strips on the floor
  ['bone', '#ece7dc'], // readable shapes: bodies, HUD text
  ['flare', '#ff9a3d'], // low furnace-glow light colour
];

export const TINTS = Object.fromEntries(SWATCHES);

export function tone(name) {
  return TINTS[name];
}
