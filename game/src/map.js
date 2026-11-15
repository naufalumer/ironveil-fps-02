// IRONVEIL — the night foundry map: one state-owned solid list, built
// once. A 64 x 44 m steelworks: attacker yard south, defender yard
// north, two charge zones (A furnace hall west, B rail yard east), three
// lanes (A-long, mid, B-long). Every solid is a Box3 collider and a
// bullet stopper. No textures, no models: geometry + light + palette
// carry the look. Flat ground: bots and the player path on one plane, so
// the waypoint graph in the squad module stays honest.
import * as THREE from 'three';
import { TINTS } from './palette.js';

const pt = (x, z) => ({ x, z });

// Charge-zone anchors, shared with the squad module (routes) and the
// charge module (plant zones).
export const ZONES = {
  A: { x: -21, z: -15, r: 3.4 },
  B: { x: 21, z: -15, r: 3.4 },
};
export const TEAM_SPAWNS = {
  attackers: [pt(-3, 18.5), pt(0, 19.5), pt(3, 18.5)],
  defenders: [pt(-3, -18.5), pt(0, -19.5), pt(3, -18.5), pt(-6, -17.5), pt(6, -17.5)],
};

// Waypoint graph: nodes are open-ground positions, links are walkable
// pairs. Bots BFS over this graph; the player is free to walk anywhere.
export const NODES = [
  pt(0, 18.5), // attackers' spawn
  pt(-24, 12), // A-long, low
  pt(-24, 0), // A-long, mid
  pt(-24, -6), // A-long, high
  pt(-18.75, -8.5), // A door (through the east door gap, x -18..-16)
  pt(-21, -15), // site A
  pt(-25, -13.5), // A hold, west
  pt(-15, -13.5), // A hold, east
  pt(0, 10), // mid, low
  pt(0, 2), // mid doors
  pt(0, -6), // mid, high
  pt(0, -18.5), // defenders' spawn
  pt(24, 12), // B-long, low
  pt(24, 0), // B-long, mid
  pt(24, -6), // B-long, high
  pt(21, -8.5), // B yard entry
  pt(21, -15), // site B
  pt(18, -10), // B hold, west
  pt(25, -9), // B hold, east
  pt(-8, 14), // A-long entry
  pt(8, 14), // B-long entry
  pt(-2, -4), // mid hold, west
  pt(7.5, -2), // mid hold, east
  pt(-12, 6), // cross to A
  pt(12, 7), // cross to B
  pt(0, -13), // mid roamer hold (fifth defender)
];
export const LINKS = [
  [0, 19],
  [0, 8],
  [0, 20],
  [19, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [4, 6],
  [5, 6],
  [5, 7],
  [8, 9],
  [9, 10],
  [10, 11],
  [10, 21],
  [21, 9],
  [22, 10],
  [8, 23],
  [8, 24],
  [23, 2],
  [24, 13],
  [20, 12],
  [12, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [15, 17],
  [15, 18],
  [16, 17],
  [16, 18],
  // No direct spawn->A-hold links: the straight lines cross the furnace
  // hall's east wall. Bots route around it via mid and the A door (node 4).
  [11, 21],
  [11, 22],
  [11, 25],
  [25, 10],
  [2, 23],
  [13, 24],
  [9, 23],
  [9, 24],
];

export function buildFoundry(scene) {
  const group = new THREE.Group();
  group.name = 'foundry';
  scene.add(group);

  const mats = {};
  for (const name of Object.keys(TINTS)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(TINTS[name]),
      roughness: name === 'girder' ? 0.45 : 0.92,
      metalness: name === 'girder' ? 0.55 : 0.04,
    });
  }
  // Ingot stacks: three scorched hues, still inside the palette family.
  const stackMats = [TINTS.rust, TINTS.moss, TINTS.molten].map(
    (c) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(c),
        roughness: 0.8,
        metalness: 0.15,
      }),
  );

  const solids = [];
  const targets = [];
  let stackNext = 0;

  function solid(spec) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]),
      spec.mat,
    );
    mesh.position.set(spec.at[0], spec.at[1], spec.at[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (spec.solid !== false) {
      solids.push(new THREE.Box3().setFromObject(mesh));
      targets.push(mesh);
    }
    return mesh;
  }
  function stack(spec) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]),
      stackMats[stackNext++ % stackMats.length],
    );
    mesh.position.set(spec.at[0], spec.at[1], spec.at[2]);
    mesh.rotation.y = spec.rot || 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    solids.push(new THREE.Box3().setFromObject(mesh));
    targets.push(mesh);
    // Straps: two thin raised strips so a flat box reads as a stacked load.
    for (const off of [-spec.size[0] / 4, spec.size[0] / 4]) {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, spec.size[1] + 0.02, spec.size[2] + 0.02),
        mesh.material,
      );
      strap.position.set(
        spec.at[0] + Math.cos(mesh.rotation.y) * off,
        spec.at[1],
        spec.at[2] - Math.sin(mesh.rotation.y) * off,
      );
      strap.rotation.y = mesh.rotation.y;
      strap.castShadow = true;
      group.add(strap);
    }
    return mesh;
  }
  function drum(x, z, color) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.7,
        metalness: 0.3,
      }),
    );
    mesh.position.set(x, 0.53, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Collision as a box: bots and the player never need a true cylinder.
    solids.push(
      new THREE.Box3(
        new THREE.Vector3(x - 0.42, 0, z - 0.42),
        new THREE.Vector3(x + 0.42, 1.05, z + 0.42),
      ),
    );
    targets.push(mesh);
    return mesh;
  }
  function kiln(x, z) {
    // The hall's furnace: a squat cylinder with a glowing mouth.
    // Collision is a box around it; the mouth is an emissive disc facing
    // the hall.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 1.9, 3.6, 16),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(TINTS.girder),
        roughness: 0.5,
        metalness: 0.6,
      }),
    );
    body.position.set(x, 1.8, z);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 20),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(TINTS.molten) }),
    );
    mouth.position.set(x + 1.75, 1.1, z);
    mouth.rotation.y = Math.PI / 2;
    group.add(mouth);
    const glow = new THREE.PointLight(new THREE.Color(TINTS.molten), 30, 18, 1.6);
    glow.position.set(x + 2.4, 1.4, z);
    group.add(glow);
    solids.push(
      new THREE.Box3(
        new THREE.Vector3(x - 1.7, 0, z - 1.7),
        new THREE.Vector3(x + 1.7, 3.6, z + 1.7),
      ),
    );
    targets.push(body);
    return body;
  }

  // --- Ground and perimeter -------------------------------------------------
  solid({ size: [64.4, 0.4, 44.4], at: [0, -0.2, 0], mat: mats.slab }); // foundry slab
  solid({ size: [0.5, 5, 44.4], at: [-32.2, 2.5, 0], mat: mats.bulkhead });
  solid({ size: [0.5, 5, 44.4], at: [32.2, 2.5, 0], mat: mats.bulkhead });
  solid({ size: [64.4, 5, 0.5], at: [0, 2.5, -22.2], mat: mats.bulkhead });
  solid({ size: [64.4, 5, 0.5], at: [0, 2.5, 22.2], mat: mats.bulkhead });
  // Painted lane strips on the slab: thin, flush, non-colliding.
  solid({ size: [1.6, 0.02, 40], at: [-24, 0.01, 0], mat: mats.stripe, solid: false });
  solid({ size: [1.6, 0.02, 40], at: [24, 0.01, 0], mat: mats.stripe, solid: false });
  solid({ size: [1.6, 0.02, 30], at: [0, 0.01, 4], mat: mats.stripe, solid: false });

  // --- Site A: furnace hall -------------------------------------------------
  // West wall with two door gaps (x -27..-25 and -18..-16 at z -9), east
  // wall solid, north wall solid; interior pillars + the furnace + ingot
  // stacks.
  solid({ size: [0.5, 4.4, 12.4], at: [-29.2, 2.2, -15], mat: mats.bulkhead }); // west
  solid({ size: [0.5, 4.4, 12.4], at: [-12.8, 2.2, -15], mat: mats.bulkhead }); // east
  solid({ size: [16.9, 4.4, 0.5], at: [-21, 2.2, -21.2], mat: mats.bulkhead }); // north
  solid({ size: [4.4, 4.4, 0.5], at: [-27, 2.2, -8.8], mat: mats.bulkhead }); // south, west of door 1
  solid({ size: [4.4, 4.4, 0.5], at: [-15, 2.2, -8.8], mat: mats.bulkhead }); // south, east of door 2
  solid({ size: [1.4, 4.4, 0.5], at: [-21, 2.2, -8.8], mat: mats.bulkhead }); // south, between doors (3.1 m gaps each side)
  solid({ size: [1.0, 4.4, 1.0], at: [-26, 2.2, -18], mat: mats.column });
  solid({ size: [1.0, 4.4, 1.0], at: [-16, 2.2, -18], mat: mats.column });
  solid({ size: [1.0, 4.4, 1.0], at: [-26, 2.2, -11], mat: mats.column });
  solid({ size: [1.0, 4.4, 1.0], at: [-16, 2.2, -11], mat: mats.column });
  kiln(-24, -18);
  stack({ size: [3.2, 2.6, 1.4], at: [-27.5, 1.3, -13.5], rot: 0 });
  stack({ size: [3.2, 2.6, 1.4], at: [-14.5, 1.3, -17.5], rot: 0 });
  solid({ size: [1.2, 1.1, 1.2], at: [-24.5, 0.55, -17.5], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [-17.5, 0.55, -12.5], mat: mats.timber });
  drum(-28, -10.5, TINTS.rust);
  drum(-14, -19.5, TINTS.moss);

  // --- Site B: rail yard ----------------------------------------------------
  // Open yard, gantry legs + beam overhead, ingot stacks as cover, two
  // rail tracks (flush strips, no collision) running north-south through
  // the yard.
  for (const [lx, lz] of [
    [15, -19],
    [27, -19],
    [15, -11],
    [27, -11],
  ]) {
    solid({ size: [1.1, 9, 1.1], at: [lx, 4.5, lz], mat: mats.girder });
  }
  solid({ size: [14.5, 1.0, 1.4], at: [21, 9.4, -19], mat: mats.girder }); // gantry beam north
  solid({ size: [14.5, 1.0, 1.4], at: [21, 9.4, -11], mat: mats.girder }); // gantry beam south
  solid({ size: [1.2, 1.2, 8.5], at: [21, 10.4, -15], mat: mats.girder }); // gantry bridge
  solid({ size: [1.6, 1.4, 1.6], at: [21, 8.2, -15], mat: mats.molten }); // gantry cab (hanging block)
  solid({ size: [0.5, 0.06, 10], at: [18, 0.03, -15], mat: mats.girder, solid: false }); // rail 1
  solid({ size: [0.5, 0.06, 10], at: [24, 0.03, -15], mat: mats.girder, solid: false }); // rail 2
  stack({ size: [6.0, 2.6, 2.6], at: [26.5, 1.3, -17.5], rot: 0 });
  stack({ size: [6.0, 2.6, 2.6], at: [26.5, 3.9, -17.5], rot: 0 }); // stacked
  stack({ size: [6.0, 2.6, 2.6], at: [15.5, 1.3, -17.5], rot: 0 });
  stack({ size: [3.2, 2.6, 2.6], at: [28, 1.3, -11.5], rot: Math.PI / 2 });
  solid({ size: [1.2, 1.1, 1.2], at: [17.5, 0.55, -12.5], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [24.5, 0.55, -12], mat: mats.timber });
  drum(14.5, -19.5, TINTS.molten);

  // --- Mid: double doors in the smelter wall -------------------------------
  solid({ size: [6.5, 4, 0.5], at: [-4.75, 2, 0], mat: mats.bulkhead });
  solid({ size: [6.5, 4, 0.5], at: [4.75, 2, 0], mat: mats.bulkhead });
  solid({ size: [3.2, 4.4, 0.5], at: [-8, 2.2, 0], mat: mats.bulkhead }); // west stub
  solid({ size: [3.2, 4.4, 0.5], at: [8, 2.2, 0], mat: mats.bulkhead }); // east stub
  stack({ size: [3.0, 2.4, 1.4], at: [-3.5, 1.2, 5.5], rot: 0.35 });
  stack({ size: [3.0, 2.4, 1.4], at: [3.5, 1.2, -5.5], rot: -0.35 });
  solid({ size: [1.2, 1.1, 1.2], at: [-6.5, 0.55, -3], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [6.5, 0.55, 3], mat: mats.timber });

  // --- Lanes: cover ingots + crates ----------------------------------------
  stack({ size: [3.2, 2.6, 1.4], at: [-27, 1.3, 4], rot: 0.2 });
  stack({ size: [3.2, 2.6, 1.4], at: [-27.5, 1.3, -2.5], rot: -0.15 });
  solid({ size: [1.2, 1.1, 1.2], at: [-20.5, 0.55, 8], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [-29, 0.55, 10], mat: mats.timber });
  stack({ size: [3.2, 2.6, 1.4], at: [27, 1.3, 4], rot: -0.2 });
  stack({ size: [3.2, 2.6, 1.4], at: [27.5, 1.3, -2.5], rot: 0.15 });
  solid({ size: [1.2, 1.1, 1.2], at: [20.5, 0.55, 8], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [29, 0.55, 10], mat: mats.timber });
  // Spawn yards: low crates only, so spawns stay readable.
  solid({ size: [1.2, 1.1, 1.2], at: [-8, 0.55, 16], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [8, 0.55, 16], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [-8, 0.55, -16], mat: mats.timber });
  solid({ size: [1.2, 1.1, 1.2], at: [8, 0.55, -16], mat: mats.timber });

  // --- Site markers: glowing rings flat on the slab ------------------------
  const ringGeo = new THREE.RingGeometry(2.6, 3.4, 40);
  for (const zone of Object.values(ZONES)) {
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(TINTS.molten),
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(zone.x, 0.03, zone.z);
    group.add(ring);
  }

  // --- Light: furnace glow from the west, cool night fill, warm lamps ------
  scene.fog = new THREE.Fog(new THREE.Color(TINTS.abyss), 26, 78);
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(TINTS.haze),
    new THREE.Color(TINTS.slab),
    0.85,
  );
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color(TINTS.flare), 2.4);
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
  const fill = new THREE.DirectionalLight(new THREE.Color(TINTS.moss), 0.5);
  fill.position.set(20, 12, -18);
  scene.add(fill);
  // Two lamp posts with warm point lights over the mid doors and the yard.
  for (const [lx, lz] of [
    [0, 3],
    [21, -8],
  ]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8),
      mats.girder,
    );
    pole.position.set(lx, 2.7, lz);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(TINTS.molten) }),
    );
    lamp.position.set(lx, 5.5, lz);
    group.add(lamp);
    const light = new THREE.PointLight(new THREE.Color(TINTS.molten), 14, 16, 1.8);
    light.position.set(lx, 5.3, lz);
    group.add(light);
  }

  return { solids, targets, group };
}
