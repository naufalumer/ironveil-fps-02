// The look plan, in one place: a night foundry — cold blue-grey steel and
// concrete, molten orange glow from the furnace and lamps, slag-green
// painted steel, pale ink for the player-readable shapes. The same names
// are the CSS custom properties in index.html.
export const PALETTE = {
  night: '#0d1117', // sky / fog / page background
  sky: '#232c3a', // hemisphere sky bounce
  concrete: '#333a42', // foundry floor
  wall: '#414b55', // perimeter + furnace hall walls
  pillar: '#4d5865',
  steel: '#5d6b7a', // gantry + lamp poles
  crate: '#6e5b3f', // wooden crates
  ingot: '#7a3d22', // rusted ingot stacks
  slag: '#2e6b52', // painted steel + cool fill
  ember: '#ff7a1a', // accent: furnace glow, site rings, HUD highlights
  lane: '#4a545f', // painted lane strips on the floor
  ink: '#ece7dc', // readable shapes: bodies, HUD text
  sun: '#ff9a3d', // low furnace glow colour
};

export function shade(name) {
  return PALETTE[name];
}
