// The arsenal: four hitscan guns with distinct character, plus the view
// models. main.js owns the ray and the damage; this module owns the
// numbers, the magazine, the reload, the spread that punishes moving
// fire, and the kick. Spread grows with flat speed and with sustained
// fire (bloom), and resets when the shooter stops and waits — stopping
// to aim pays. A head hit pays 3.5x a body hit, so crosshair placement
// matters more than the trigger.
import * as THREE from 'three';
import { TINTS } from './palette.js';

export const GUNBOOK = {
  pistol: {
    label: 'Vandal P10',
    cost: 0,
    power: 24,
    headScale: 3.5,
    interval: 0.16,
    automatic: false,
    clip: 13,
    spare: 52,
    reloadTime: 1.25,
    stillSpread: 0.005,
    moveSpread: 0.032,
    bloomStep: 0.004,
    bloomCap: 0.02,
    recoil: 0.006,
    pace: 1.0,
    scope: 1,
  },
  smg: {
    label: 'Ripper SMG',
    cost: 1100,
    power: 20,
    headScale: 3.5,
    interval: 0.07,
    automatic: true,
    clip: 30,
    spare: 90,
    reloadTime: 1.6,
    stillSpread: 0.009,
    moveSpread: 0.048,
    bloomStep: 0.003,
    bloomCap: 0.03,
    recoil: 0.005,
    pace: 0.97,
    scope: 1,
  },
  rifle: {
    label: 'Anvil Rifle',
    cost: 2700,
    power: 32,
    headScale: 3.5,
    interval: 0.105,
    automatic: true,
    clip: 25,
    spare: 75,
    reloadTime: 1.9,
    stillSpread: 0.002,
    moveSpread: 0.03,
    bloomStep: 0.0025,
    bloomCap: 0.018,
    recoil: 0.009,
    pace: 0.93,
    scope: 1,
  },
  marksman: {
    label: 'Longshot DMR',
    cost: 3800,
    power: 78,
    headScale: 3.5,
    interval: 0.9,
    automatic: false,
    clip: 5,
    spare: 15,
    reloadTime: 2.5,
    stillSpread: 0.0008,
    moveSpread: 0.055,
    bloomStep: 0.012,
    bloomCap: 0.03,
    recoil: 0.026,
    pace: 0.88,
    scope: 2.2,
  },
};
export const GUN_ORDER = ['pistol', 'smg', 'rifle', 'marksman'];
const FLASH_TIME = 0.06;

// View-model parts per gun: [width, height, depth, x, y, z, material].
const MODEL_PARTS = {
  pistol: [
    [0.07, 0.09, 0.2, 0, 0, -0.05, 'hull'],
    [0.05, 0.12, 0.06, 0, -0.08, 0.03, 'grip'],
    [0.02, 0.02, 0.16, 0, 0.05, -0.06, 'accent'],
  ],
  smg: [
    [0.08, 0.09, 0.34, 0, 0, -0.08, 'hull'],
    [0.04, 0.04, 0.26, 0, 0.02, -0.3, 'grip'],
    [0.05, 0.14, 0.05, 0, -0.09, 0.02, 'grip'],
    [0.03, 0.05, 0.08, 0, -0.06, -0.12, 'accent'],
  ],
  rifle: [
    [0.09, 0.1, 0.46, 0, 0, -0.1, 'hull'],
    [0.045, 0.045, 0.4, 0, 0.025, -0.45, 'grip'],
    [0.07, 0.09, 0.2, 0, -0.02, 0.28, 'grip'],
    [0.03, 0.04, 0.12, 0, 0.06, -0.18, 'accent'],
    [0.05, 0.03, 0.1, 0, -0.08, -0.05, 'accent'],
  ],
  marksman: [
    [0.09, 0.11, 0.62, 0, 0, -0.16, 'hull'],
    [0.05, 0.05, 0.5, 0, 0.03, -0.55, 'grip'],
    [0.07, 0.07, 0.16, 0, 0.09, -0.14, 'accent'],
    [0.07, 0.09, 0.18, 0, -0.02, 0.3, 'grip'],
    [0.02, 0.06, 0.02, 0, -0.09, -0.3, 'accent'],
  ],
};

function buildGunModel(key) {
  const mats = {
    grip: new THREE.MeshStandardMaterial({
      color: new THREE.Color(TINTS.girder),
      roughness: 0.65,
      metalness: 0.3,
    }),
    hull: new THREE.MeshStandardMaterial({
      color: new THREE.Color(TINTS.abyss),
      roughness: 0.45,
      metalness: 0.4,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: new THREE.Color(TINTS.molten),
      roughness: 0.6,
      metalness: 0.2,
    }),
  };
  const model = new THREE.Group();
  for (const [w, h, d, x, y, z, mat] of MODEL_PARTS[key]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    model.add(mesh);
  }
  model.position.set(0.26, -0.23, -0.48);
  model.scale.setScalar(0.72);
  return model;
}

export function makeArsenal(camera) {
  const models = {};
  for (const key of GUN_ORDER) models[key] = buildGunModel(key);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(TINTS.molten),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  flash.position.set(0.26, -0.21, -0.85);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(TINTS.molten), 0, 6);
  flashLight.position.set(0.26, -0.19, -0.6);
  camera.add(flashLight);

  const state = {
    equipped: 'rifle',
    unlocked: { pistol: true, smg: false, rifle: false, marksman: false },
    loads: {},
    delay: 0,
    reloadIn: 0,
    flashIn: 0,
    jolt: 0,
    bloomNow: 0,
    scoped: false,
  };
  for (const key of GUN_ORDER) {
    state.loads[key] = { clip: GUNBOOK[key].clip, spare: GUNBOOK[key].spare };
  }
  // The player starts with the rifle bought in the first buy phase's
  // budget: give it here so round 1 is playable even before any purchase.
  state.unlocked.rifle = true;
  state.equipped = 'rifle';

  let activeModel = models[state.equipped];
  camera.add(activeModel);

  function spec() {
    return GUNBOOK[state.equipped];
  }

  function tick(dt) {
    state.delay = Math.max(0, state.delay - dt);
    state.flashIn = Math.max(0, state.flashIn - dt);
    state.bloomNow = Math.max(0, state.bloomNow - dt * 0.03);
    state.jolt += (0 - state.jolt) * Math.min(1, dt * 13);
    activeModel.position.z = -0.48 + state.jolt;
    activeModel.rotation.x = state.jolt * 2.4;
    activeModel.visible =
      state.reloadIn === 0 || Math.sin(state.reloadIn * 20) > -0.6;
    flash.visible = state.flashIn > 0;
    flash.rotation.z = state.flashIn * 8;
    flashLight.intensity = state.flashIn > 0 ? 20 : 0;
    if (state.reloadIn > 0) {
      state.reloadIn = Math.max(0, state.reloadIn - dt);
      activeModel.rotation.x =
        -0.5 * Math.min(1, (spec().reloadTime - state.reloadIn) * 2);
      if (state.reloadIn === 0) {
        const slot = state.loads[state.equipped];
        const need = spec().clip - slot.clip;
        const take = Math.min(need, slot.spare);
        slot.clip += take;
        slot.spare -= take;
      }
    }
  }

  return {
    state,
    spec,
    tick,
    primed() {
      const slot = state.loads[state.equipped];
      return slot.clip > 0 && state.delay === 0 && state.reloadIn === 0;
    },
    // Returns the current spread in radians. Called with the shooter's speed.
    spreadAt(speed) {
      const d = spec();
      const moving = Math.min(1, speed / 5.6);
      return d.stillSpread + moving * d.moveSpread + state.bloomNow;
    },
    onFire() {
      const d = spec();
      state.delay = d.interval;
      state.flashIn = FLASH_TIME;
      state.jolt = 0.05 + d.recoil * 2;
      state.bloomNow = Math.min(d.bloomCap, state.bloomNow + d.bloomStep);
    },
    spendShell() {
      const slot = state.loads[state.equipped];
      if (slot.clip <= 0) return false;
      slot.clip -= 1;
      return true;
    },
    beginReload() {
      const slot = state.loads[state.equipped];
      if (state.reloadIn > 0 || slot.clip === spec().clip || slot.spare === 0) {
        return false;
      }
      state.reloadIn = spec().reloadTime;
      return true;
    },
    equip(key) {
      if (!state.unlocked[key] || key === state.equipped || state.reloadIn > 0) {
        return false;
      }
      camera.remove(activeModel);
      state.equipped = key;
      activeModel = models[key];
      camera.add(activeModel);
      state.delay = Math.max(state.delay, 0.25);
      state.scoped = false;
      return true;
    },
    purchase(key) {
      if (state.unlocked[key]) return { ok: false, reason: 'owned' };
      state.unlocked[key] = true;
      state.loads[key] = { clip: GUNBOOK[key].clip, spare: GUNBOOK[key].spare };
      this.equip(key);
      return { ok: true };
    },
    restock() {
      for (const key of GUN_ORDER) {
        if (!state.unlocked[key]) continue;
        state.loads[key] = { clip: GUNBOOK[key].clip, spare: GUNBOOK[key].spare };
      }
      state.delay = 0;
      state.reloadIn = 0;
      state.flashIn = 0;
      state.jolt = 0;
      state.bloomNow = 0;
    },
    muzzleAt(out) {
      // Muzzle tip in world space, for tracers. Reuses the caller's vector.
      out.set(0.26, -0.21, -0.85);
      return camera.localToWorld(out);
    },
  };
}
