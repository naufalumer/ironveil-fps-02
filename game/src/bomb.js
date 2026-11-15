// The charge: carried by the player, planted at a site by holding E,
// then a 35 s fuse the defenders race to defuse. The charge is one mesh
// with a blinking light; its state lives here, the round logic lives in
// the match module.
import * as THREE from 'three';
import { ZONES } from './map.js';
import { TINTS } from './palette.js';

export const PLANT_TIME = 3;
export const FUSE_TIME = 35;

export function makeCharge(scene) {
  const group = new THREE.Group();
  const casing = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(TINTS.abyss),
      roughness: 0.4,
      metalness: 0.6,
    }),
  );
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(TINTS.molten) }),
  );
  lamp.position.set(0.1, 0.12, 0);
  const aerial = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(TINTS.girder),
      roughness: 0.4,
      metalness: 0.7,
    }),
  );
  aerial.position.set(-0.12, 0.22, 0);
  group.add(casing, lamp, aerial);
  group.visible = false;
  scene.add(group);

  const state = {
    onBack: true, // on the player's back until planted
    set: false,
    zone: null, // 'A' | 'B'
    plantIn: 0,
    fuseIn: 0,
    pos: new THREE.Vector3(),
    beepIn: 0,
    blown: false,
  };

  function zoneAt(x, z) {
    for (const [name, zone] of Object.entries(ZONES)) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      if (dx * dx + dz * dz < zone.r * zone.r) return name;
    }
    return null;
  }

  return {
    state,
    group,
    zoneAt,
    resetCharge() {
      state.onBack = true;
      state.set = false;
      state.zone = null;
      state.plantIn = 0;
      state.fuseIn = 0;
      state.blown = false;
      state.beepIn = 0;
      group.visible = false;
    },
    // Planting: called every fixed step while the player holds E inside a
    // zone. Returns 'planted' the step the channel completes, else null.
    plantTick(dt, playerPos, holding) {
      if (state.set || !state.onBack) return null;
      const zone = zoneAt(playerPos.x, playerPos.z);
      if (!holding || !zone) {
        state.plantIn = Math.max(0, state.plantIn - dt * 2);
        return null;
      }
      state.plantIn += dt;
      if (state.plantIn >= PLANT_TIME) {
        state.set = true;
        state.onBack = false;
        state.zone = zone;
        state.fuseIn = FUSE_TIME;
        state.pos.set(ZONES[zone].x, 0.12, ZONES[zone].z);
        group.position.copy(state.pos);
        group.visible = true;
        return 'planted';
      }
      return null;
    },
    // Fuse countdown. Returns 'detonated' when the timer runs out.
    // Beeps accelerate as the fuse burns down; hooks.beep() plays the sound.
    fuseTick(dt, hooks) {
      if (!state.set || state.blown) return null;
      state.fuseIn -= dt;
      state.beepIn -= dt;
      const gap = state.fuseIn > 20 ? 1.0 : state.fuseIn > 10 ? 0.55 : 0.28;
      if (state.beepIn <= 0) {
        state.beepIn = gap;
        if (hooks.beep) hooks.beep(state.fuseIn);
      }
      if (state.fuseIn <= 0) {
        state.blown = true;
        return 'detonated';
      }
      return null;
    },
    // Blink the charge light: faster as the fuse burns. Cheap: one
    // visibility flip.
    pulseLight(time) {
      if (!state.set) return;
      const fast = state.fuseIn < 10 ? 0.12 : 0.5;
      lamp.visible = time % (fast * 2) < fast;
    },
  };
}
