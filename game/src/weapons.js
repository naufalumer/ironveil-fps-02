// Weapons: four hitscan guns with distinct character, plus the view models.
// main.js owns the ray and the damage; this module owns the numbers, the
// magazine, the reload, the spread that punishes moving fire, and the kick.
// Spread grows with ground speed and with sustained fire (bloom), and resets
// when the shooter stops and waits — stopping to aim pays. A head hit pays
// 3.5x a body hit, so the crosshair placement matters more than the trigger.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPON_DEFS = {
  pistol: {
    name: 'Vandal P10', price: 0, damage: 24, headMult: 3.5, gap: 0.16, auto: false,
    mag: 13, reserve: 52, reload: 1.25, spreadStill: 0.005, spreadMove: 0.032,
    bloom: 0.004, bloomMax: 0.02, kick: 0.006, moveSpeed: 1.0, zoom: 1,
  },
  smg: {
    name: 'Ripper SMG', price: 1100, damage: 20, headMult: 3.5, gap: 0.07, auto: true,
    mag: 30, reserve: 90, reload: 1.6, spreadStill: 0.009, spreadMove: 0.048,
    bloom: 0.003, bloomMax: 0.03, kick: 0.005, moveSpeed: 0.97, zoom: 1,
  },
  rifle: {
    name: 'Anvil Rifle', price: 2700, damage: 32, headMult: 3.5, gap: 0.105, auto: true,
    mag: 25, reserve: 75, reload: 1.9, spreadStill: 0.002, spreadMove: 0.03,
    bloom: 0.0025, bloomMax: 0.018, kick: 0.009, moveSpeed: 0.93, zoom: 1,
  },
  marksman: {
    name: 'Longshot DMR', price: 3800, damage: 78, headMult: 3.5, gap: 0.9, auto: false,
    mag: 5, reserve: 15, reload: 2.5, spreadStill: 0.0008, spreadMove: 0.055,
    bloom: 0.012, bloomMax: 0.03, kick: 0.026, moveSpeed: 0.88, zoom: 2.2,
  },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'marksman'];
const MUZZLE_TIME = 0.06;

function buildViewModel(def, key) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.65, metalness: 0.3 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.night), roughness: 0.45, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.6, metalness: 0.2 });
  const model = new THREE.Group();
  const add = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  if (key === 'pistol') {
    add(0.07, 0.09, 0.2, 0, 0, -0.05, body);
    add(0.05, 0.12, 0.06, 0, -0.08, 0.03, grip);
    add(0.02, 0.02, 0.16, 0, 0.05, -0.06, dark);
  } else if (key === 'smg') {
    add(0.08, 0.09, 0.34, 0, 0, -0.08, body);
    add(0.04, 0.04, 0.26, 0, 0.02, -0.3, grip);
    add(0.05, 0.14, 0.05, 0, -0.09, 0.02, grip);
    add(0.03, 0.05, 0.08, 0, -0.06, -0.12, dark);
  } else if (key === 'rifle') {
    add(0.09, 0.1, 0.46, 0, 0, -0.1, body);
    add(0.045, 0.045, 0.4, 0, 0.025, -0.45, grip);
    add(0.07, 0.09, 0.2, 0, -0.02, 0.28, grip);
    add(0.03, 0.04, 0.12, 0, 0.06, -0.18, dark);
    add(0.05, 0.03, 0.1, 0, -0.08, -0.05, dark);
  } else {
    add(0.09, 0.11, 0.62, 0, 0, -0.16, body);
    add(0.05, 0.05, 0.5, 0, 0.03, -0.55, grip);
    add(0.07, 0.07, 0.16, 0, 0.09, -0.14, dark); // scope
    add(0.07, 0.09, 0.18, 0, -0.02, 0.3, grip);
    add(0.02, 0.06, 0.02, 0, -0.09, -0.3, dark); // bipod stub
  }
  model.position.set(0.26, -0.23, -0.48);
  model.scale.setScalar(0.72);
  return model;
}

export function createWeapons(camera) {
  const models = {};
  for (const key of WEAPON_ORDER) models[key] = buildViewModel(WEAPON_DEFS[key], key);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.21, -0.85);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 6);
  flashLight.position.set(0.26, -0.19, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'rifle',
    owned: { pistol: true, smg: false, rifle: false, marksman: false },
    ammo: {},
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    zoomed: false,
  };
  for (const key of WEAPON_ORDER) {
    state.ammo[key] = { mag: WEAPON_DEFS[key].mag, reserve: WEAPON_DEFS[key].reserve };
  }
  // The player starts with the rifle bought in the first buy phase's budget:
  // give it here so round 1 is playable even before any purchase.
  state.owned.rifle = true;
  state.current = 'rifle';

  let activeModel = models[state.current];
  camera.add(activeModel);

  function def() {
    return WEAPON_DEFS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.03);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    activeModel.position.z = -0.48 + state.kick;
    activeModel.rotation.x = state.kick * 2.4;
    activeModel.visible = state.reloadLeft === 0 || Math.sin(state.reloadLeft * 20) > -0.6;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 8;
    flashLight.intensity = state.flash > 0 ? 20 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      activeModel.rotation.x = -0.5 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = state.ammo[state.current];
        const need = def().mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      const slot = state.ammo[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    // Returns the current spread in radians. Called with the shooter's speed.
    spread(speed) {
      const d = def();
      const moving = Math.min(1, speed / 5.6);
      return d.spreadStill + moving * d.spreadMove + state.bloom;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.05 + d.kick * 2;
      state.bloom = Math.min(d.bloomMax, state.bloom + d.bloom);
    },
    takeRound() {
      const slot = state.ammo[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const slot = state.ammo[state.current];
      if (state.reloadLeft > 0 || slot.mag === def().mag || slot.reserve === 0) return false;
      state.reloadLeft = def().reload;
      return true;
    },
    switchTo(key) {
      if (!state.owned[key] || key === state.current || state.reloadLeft > 0) return false;
      camera.remove(activeModel);
      state.current = key;
      activeModel = models[key];
      camera.add(activeModel);
      state.cooldown = Math.max(state.cooldown, 0.25);
      state.zoomed = false;
      return true;
    },
    buy(key) {
      if (state.owned[key]) return { ok: false, reason: 'owned' };
      state.owned[key] = true;
      state.ammo[key] = { mag: WEAPON_DEFS[key].mag, reserve: WEAPON_DEFS[key].reserve };
      this.switchTo(key);
      return { ok: true };
    },
    refillAmmo() {
      for (const key of WEAPON_ORDER) {
        if (!state.owned[key]) continue;
        state.ammo[key] = { mag: WEAPON_DEFS[key].mag, reserve: WEAPON_DEFS[key].reserve };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
    muzzleWorld(out) {
      // Muzzle tip in world space, for tracers. Reuses the caller's vector.
      out.set(0.26, -0.21, -0.85);
      return camera.localToWorld(out);
    },
  };
}
