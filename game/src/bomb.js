// The charge: carried by the player, planted at a site by holding E,
// then a 35 s fuse the defenders race to defuse. The charge is one mesh
// with a blinking light; its state lives here, the round logic lives in
// rounds.js.
import * as THREE from 'three';
import { SITES } from './map.js';
import { PALETTE } from './palette.js';

export const PLANT_SECONDS = 3;
export const FUSE_SECONDS = 35;

export function createBomb(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.night), roughness: 0.4, metalness: 0.6 }),
  );
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember) }),
  );
  light.position.set(0.1, 0.12, 0);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.4, metalness: 0.7 }),
  );
  antenna.position.set(-0.12, 0.22, 0);
  group.add(body, light, antenna);
  group.visible = false;
  scene.add(group);

  const state = {
    carried: true, // on the player's back until planted
    planted: false,
    site: null, // 'A' | 'B'
    plantProgress: 0,
    fuseLeft: 0,
    position: new THREE.Vector3(),
    beepTimer: 0,
    exploded: false,
  };

  function siteAt(x, z) {
    for (const [name, site] of Object.entries(SITES)) {
      const dx = x - site.x;
      const dz = z - site.z;
      if (dx * dx + dz * dz < site.r * site.r) return name;
    }
    return null;
  }

  return {
    state,
    group,
    siteAt,
    reset() {
      state.carried = true;
      state.planted = false;
      state.site = null;
      state.plantProgress = 0;
      state.fuseLeft = 0;
      state.exploded = false;
      state.beepTimer = 0;
      group.visible = false;
    },
    // Planting: called every fixed step while the player holds E inside a site.
    // Returns 'planted' the step the channel completes, else null.
    plantStep(dt, playerPos, holding) {
      if (state.planted || !state.carried) return null;
      const site = siteAt(playerPos.x, playerPos.z);
      if (!holding || !site) {
        state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
        return null;
      }
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_SECONDS) {
        state.planted = true;
        state.carried = false;
        state.site = site;
        state.fuseLeft = FUSE_SECONDS;
        state.position.set(SITES[site].x, 0.12, SITES[site].z);
        group.position.copy(state.position);
        group.visible = true;
        return 'planted';
      }
      return null;
    },
    // Fuse countdown. Returns 'detonated' when the timer runs out.
    // Beeps accelerate as the fuse burns down; hooks.beep() plays the sound.
    fuseStep(dt, hooks) {
      if (!state.planted || state.exploded) return null;
      state.fuseLeft -= dt;
      state.beepTimer -= dt;
      const interval = state.fuseLeft > 20 ? 1.0 : state.fuseLeft > 10 ? 0.55 : 0.28;
      if (state.beepTimer <= 0) {
        state.beepTimer = interval;
        if (hooks.beep) hooks.beep(state.fuseLeft);
      }
      if (state.fuseLeft <= 0) {
        state.exploded = true;
        return 'detonated';
      }
      return null;
    },
    // Blink the charge light: faster as the fuse burns. Cheap: one visibility flip.
    blink(time) {
      if (!state.planted) return;
      const fast = state.fuseLeft < 10 ? 0.12 : 0.5;
      light.visible = (time % (fast * 2)) < fast;
    },
  };
}
