// IRONVEIL — the night foundry map: one state-owned box list, built once.
// A 64 x 44 m steelworks: attacker yard south, defender yard north, two
// charge sites (A furnace hall west, B rail yard east), three lanes
// (A-long, mid, B-long). Every solid is a Box3 collider and a bullet
// stopper. No textures, no models: geometry + light + palette carry the
// look. Flat ground: bots and the player path on one plane, so the waypoint
// graph in bots.js stays honest.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Lane / site anchors, shared with bots.js (routes) and bomb.js (plant zones).
export const SITES = {
  A: { x: -21, z: -15, r: 3.4 },
  B: { x: 21, z: -15, r: 3.4 },
};
export const SPAWNS = {
  attackers: [
    { x: -3, z: 18.5 },
    { x: 0, z: 19.5 },
    { x: 3, z: 18.5 },
  ],
  defenders: [
    { x: -3, z: -18.5 },
    { x: 0, z: -19.5 },
    { x: 3, z: -18.5 },
    { x: -6, z: -17.5 },
    { x: 6, z: -17.5 },
  ],
};

// Waypoint graph: nodes are open-ground positions, edges are walkable links.
// Bots BFS over this graph; the player is free to walk anywhere.
export const WAYPOINTS = [
  // id: [x, z]
  [0, 18.5], // 0 attacker spawn
  [-24, 12], // 1 A-long low
  [-24, 0], // 2 A-long mid
  [-24, -6], // 3 A-long high
  [-18.75, -8.5], // 4 A door (through the east door gap, x -18..-16)
  [-21, -15], // 5 site A
  [-25, -13.5], // 6 A hold west
  [-15, -13.5], // 7 A hold east
  [0, 10], // 8 mid low
  [0, 2], // 9 mid doors
  [0, -6], // 10 mid high
  [0, -18.5], // 11 defender spawn
  [24, 12], // 12 B-long low
  [24, 0], // 13 B-long mid
  [24, -6], // 14 B-long high
  [21, -8.5], // 15 B yard entry
  [21, -15], // 16 site B
  [18, -10], // 17 B hold west
  [25, -9], // 18 B hold east
  [-8, 14], // 19 A-long entry
  [8, 14], // 20 B-long entry
  [-2, -4], // 21 mid hold west
  [7.5, -2], // 22 mid hold east
  [-12, 6], // 23 cross to A
  [12, 7], // 24 cross to B
  [0, -13], // 25 mid roamer hold (fifth defender)
];
export const EDGES = [
  [0, 19], [0, 8], [0, 20],
  [19, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [5, 6], [5, 7],
  [8, 9], [9, 10], [10, 11], [10, 21], [21, 9], [22, 10],
  [8, 23], [8, 24], [23, 2], [24, 13],
  [20, 12], [12, 13], [13, 14], [14, 15], [15, 16], [15, 17], [15, 18], [16, 17], [16, 18],
  // No direct spawn->A-hold edges: the straight lines cross the furnace
  // hall's east wall. Bots route around it via mid and the A door (node 4).
  [11, 21], [11, 22], [11, 25], [25, 10],
  [2, 23], [13, 24], [9, 23], [9, 24],
];

export function createMap(scene) {
  const group = new THREE.Group();
  group.name = 'foundry';
  scene.add(group);

  const mat = {};
  for (const name of Object.keys(PALETTE)) {
    mat[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'steel' ? 0.45 : 0.92,
      metalness: name === 'steel' ? 0.55 : 0.04,
    });
  }
  // Ingot stacks: three scorched hues, still inside the palette family.
  const ingotMats = [PALETTE.ingot, PALETTE.slag, PALETTE.ember].map(
    (c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.8, metalness: 0.15 }),
  );

  const colliders = [];
  const shootables = [];
  let ingotIndex = 0;

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }
  function ingotStack(w, h, d, x, y, z, rotY = 0) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      ingotMats[ingotIndex++ % ingotMats.length],
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    // Straps: two thin raised strips so a flat box reads as a stacked load.
    for (const off of [-w / 4, w / 4]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.08, h + 0.02, d + 0.02), mesh.material);
      strap.position.set(x + Math.cos(rotY) * off, y, z - Math.sin(rotY) * off);
      strap.rotation.y = rotY;
      strap.castShadow = true;
      group.add(strap);
    }
    return mesh;
  }
  function barrel(x, z, color) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.3 }),
    );
    mesh.position.set(x, 0.53, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Collision as a box: bots and the player never need a true cylinder.
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.42), new THREE.Vector3(x + 0.42, 1.05, z + 0.42)));
    shootables.push(mesh);
    return mesh;
  }
  function furnace(x, z) {
    // The hall's furnace: a squat cylinder with a glowing mouth. Collision
    // is a box around it; the mouth is an emissive disc facing the hall.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 1.9, 3.6, 16),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.5, metalness: 0.6 }),
    );
    body.position.set(x, 1.8, z);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 20),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember) }),
    );
    mouth.position.set(x + 1.75, 1.1, z);
    mouth.rotation.y = Math.PI / 2;
    group.add(mouth);
    const glow = new THREE.PointLight(new THREE.Color(PALETTE.ember), 30, 18, 1.6);
    glow.position.set(x + 2.4, 1.4, z);
    group.add(glow);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 1.7, 0, z - 1.7), new THREE.Vector3(x + 1.7, 3.6, z + 1.7)));
    shootables.push(body);
    return body;
  }

  // --- Ground and perimeter -------------------------------------------------
  box(64.4, 0.4, 44.4, 0, -0.2, 0, mat.concrete); // foundry slab
  box(0.5, 5, 44.4, -32.2, 2.5, 0, mat.wall);
  box(0.5, 5, 44.4, 32.2, 2.5, 0, mat.wall);
  box(64.4, 5, 0.5, 0, 2.5, -22.2, mat.wall);
  box(64.4, 5, 0.5, 0, 2.5, 22.2, mat.wall);
  // Painted lane strips on the slab: thin, flush, non-colliding.
  box(1.6, 0.02, 40, -24, 0.01, 0, mat.lane, false);
  box(1.6, 0.02, 40, 24, 0.01, 0, mat.lane, false);
  box(1.6, 0.02, 30, 0, 0.01, 4, mat.lane, false);

  // --- Site A: furnace hall -------------------------------------------------
  // West wall with two door gaps (x -27..-25 and -18..-16 at z -9), east wall solid,
  // north wall solid; interior pillars + the furnace + ingot stacks.
  box(0.5, 4.4, 12.4, -29.2, 2.2, -15, mat.wall); // west
  box(0.5, 4.4, 12.4, -12.8, 2.2, -15, mat.wall); // east
  box(16.9, 4.4, 0.5, -21, 2.2, -21.2, mat.wall); // north
  box(4.4, 4.4, 0.5, -27, 2.2, -8.8, mat.wall); // south, west of door 1
  box(4.4, 4.4, 0.5, -15, 2.2, -8.8, mat.wall); // south, east of door 2
  box(1.4, 4.4, 0.5, -21, 2.2, -8.8, mat.wall); // south, between doors (3.1 m gaps each side)
  box(1.0, 4.4, 1.0, -26, 2.2, -18, mat.pillar);
  box(1.0, 4.4, 1.0, -16, 2.2, -18, mat.pillar);
  box(1.0, 4.4, 1.0, -26, 2.2, -11, mat.pillar);
  box(1.0, 4.4, 1.0, -16, 2.2, -11, mat.pillar);
  furnace(-24, -18);
  ingotStack(3.2, 2.6, 1.4, -27.5, 1.3, -13.5, 0);
  ingotStack(3.2, 2.6, 1.4, -14.5, 1.3, -17.5, 0);
  box(1.2, 1.1, 1.2, -24.5, 0.55, -17.5, mat.crate);
  box(1.2, 1.1, 1.2, -17.5, 0.55, -12.5, mat.crate);
  barrel(-28, -10.5, PALETTE.ingot);
  barrel(-14, -19.5, PALETTE.slag);

  // --- Site B: rail yard ----------------------------------------------------
  // Open yard, gantry legs + beam overhead, ingot stacks as cover, two rail
  // tracks (flush strips, no collision) running north-south through the yard.
  for (const [lx, lz] of [[15, -19], [27, -19], [15, -11], [27, -11]]) {
    box(1.1, 9, 1.1, lx, 4.5, lz, mat.steel);
  }
  box(14.5, 1.0, 1.4, 21, 9.4, -19, mat.steel); // gantry beam north
  box(14.5, 1.0, 1.4, 21, 9.4, -11, mat.steel); // gantry beam south
  box(1.2, 1.2, 8.5, 21, 10.4, -15, mat.steel); // gantry bridge
  box(1.6, 1.4, 1.6, 21, 8.2, -15, mat.ember); // gantry cab (hanging block)
  box(0.5, 0.06, 10, 18, 0.03, -15, mat.steel, false); // rail 1
  box(0.5, 0.06, 10, 24, 0.03, -15, mat.steel, false); // rail 2
  ingotStack(6.0, 2.6, 2.6, 26.5, 1.3, -17.5, 0);
  ingotStack(6.0, 2.6, 2.6, 26.5, 3.9, -17.5, 0); // stacked
  ingotStack(6.0, 2.6, 2.6, 15.5, 1.3, -17.5, 0);
  ingotStack(3.2, 2.6, 2.6, 28, 1.3, -11.5, Math.PI / 2);
  box(1.2, 1.1, 1.2, 17.5, 0.55, -12.5, mat.crate);
  box(1.2, 1.1, 1.2, 24.5, 0.55, -12, mat.crate);
  barrel(14.5, -19.5, PALETTE.ember);

  // --- Mid: double doors in the smelter wall -------------------------------
  box(6.5, 4, 0.5, -4.75, 2, 0, mat.wall);
  box(6.5, 4, 0.5, 4.75, 2, 0, mat.wall);
  box(3.2, 4.4, 0.5, -8, 2.2, 0, mat.wall); // west stub
  box(3.2, 4.4, 0.5, 8, 2.2, 0, mat.wall); // east stub
  ingotStack(3.0, 2.4, 1.4, -3.5, 1.2, 5.5, 0.35);
  ingotStack(3.0, 2.4, 1.4, 3.5, 1.2, -5.5, -0.35);
  box(1.2, 1.1, 1.2, -6.5, 0.55, -3, mat.crate);
  box(1.2, 1.1, 1.2, 6.5, 0.55, 3, mat.crate);

  // --- Lanes: cover ingots + crates ----------------------------------------
  ingotStack(3.2, 2.6, 1.4, -27, 1.3, 4, 0.2);
  ingotStack(3.2, 2.6, 1.4, -27.5, 1.3, -2.5, -0.15);
  box(1.2, 1.1, 1.2, -20.5, 0.55, 8, mat.crate);
  box(1.2, 1.1, 1.2, -29, 0.55, 10, mat.crate);
  ingotStack(3.2, 2.6, 1.4, 27, 1.3, 4, -0.2);
  ingotStack(3.2, 2.6, 1.4, 27.5, 1.3, -2.5, 0.15);
  box(1.2, 1.1, 1.2, 20.5, 0.55, 8, mat.crate);
  box(1.2, 1.1, 1.2, 29, 0.55, 10, mat.crate);
  // Spawn yards: low crates only, so spawns stay readable.
  box(1.2, 1.1, 1.2, -8, 0.55, 16, mat.crate);
  box(1.2, 1.1, 1.2, 8, 0.55, 16, mat.crate);
  box(1.2, 1.1, 1.2, -8, 0.55, -16, mat.crate);
  box(1.2, 1.1, 1.2, 8, 0.55, -16, mat.crate);

  // --- Site markers: glowing rings flat on the slab ------------------------
  const ringGeo = new THREE.RingGeometry(2.6, 3.4, 40);
  for (const site of Object.values(SITES)) {
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    group.add(ring);
  }

  // --- Light: furnace glow from the west, cool night fill, warm lamps ------
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.night), 26, 78);
  const hemi = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.concrete), 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.4);
  sun.position.set(-18, 26, 20);
  sun.target.position.set(0, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.slag), 0.5);
  fill.position.set(20, 12, -18);
  scene.add(fill);
  // Two lamp posts with warm point lights over the mid doors and the yard.
  for (const [lx, lz] of [[0, 3], [21, -8]]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8),
      mat.steel,
    );
    pole.position.set(lx, 2.7, lz);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember) }),
    );
    lamp.position.set(lx, 5.5, lz);
    group.add(lamp);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.ember), 14, 16, 1.8);
    light.position.set(lx, 5.3, lz);
    group.add(light);
  }

  return { colliders, shootables, group };
}
