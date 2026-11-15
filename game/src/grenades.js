// Grenades: a smoke that blocks bot sight and a flash that blinds
// defenders. One thrown grenade at a time per type is enough for a
// 5-round game; the flight is a simple arc with one ground bounce, then
// the effect. Smoke banks are real objects bots test line-of-sight
// against (see the squad module).
import * as THREE from 'three';

const SMOKE_TIME = 12;
const FLASH_TIME = 3;
const FLASH_REACH = 18;
const DROP = 12;

export function makeKit(scene, map) {
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  // Smoke is unlit: a lit sphere reads as a balloon under the furnace
  // glow. Flat grey, slightly flattened spheres, clustered tight.
  const smokeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#8b98a0'),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);

  const flying = []; // { at, fly, kind, bounced }
  const banks = []; // { x, y, z, left, meshes[] }
  const state = { smokes: 0, flashes: 0, chosen: 'smoke' };

  const probe = new THREE.Box3();
  function solidHit(x, y, z) {
    probe.min.set(x - 0.12, y - 0.12, z - 0.12);
    probe.max.set(x + 0.12, y + 0.12, z + 0.12);
    for (const solid of map.solids) {
      if (probe.intersectsBox(solid)) return true;
    }
    return false;
  }

  function goOff(g, ctx) {
    if (g.kind === 'smoke') {
      const meshes = [];
      for (let i = 0; i < 7; i += 1) {
        const m = new THREE.Mesh(smokeGeo, smokeMat);
        const a = (i / 7) * Math.PI * 2;
        m.position.set(
          g.at.x + Math.cos(a) * 0.9,
          1.1 + (i % 3) * 0.4,
          g.at.z + Math.sin(a) * 0.9,
        );
        const s = 1.0 + (i % 3) * 0.3;
        m.scale.set(s, s * 0.6, s);
        smokeGroup.add(m);
        meshes.push(m);
      }
      banks.push({ x: g.at.x, y: 1.2, z: g.at.z, left: SMOKE_TIME, meshes });
    } else {
      ctx.effects.whiteout();
      ctx.audio.flashSnd();
      ctx.bots.blindFoes(g.at, FLASH_REACH, ctx.time + FLASH_TIME);
    }
  }

  return {
    state,
    banks,
    stock(kind) {
      if (kind === 'smoke') state.smokes += 1;
      else state.flashes += 1;
    },
    lob(from, dir, ctx) {
      const kind = state.chosen;
      const have = kind === 'smoke' ? state.smokes : state.flashes;
      if (have <= 0) return false;
      if (kind === 'smoke') state.smokes -= 1;
      else state.flashes -= 1;
      flying.push({
        at: from.clone(),
        fly: dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
        kind,
        bounced: false,
      });
      ctx.audio.tossSnd();
      return true;
    },
    tick(dt, ctx) {
      for (let i = flying.length - 1; i >= 0; i -= 1) {
        const g = flying[i];
        g.fly.y -= DROP * dt;
        g.at.addScaledVector(g.fly, dt);
        if (g.at.y <= 0.12) {
          g.at.y = 0.12;
          if (!g.bounced && Math.abs(g.fly.y) > 2.5) {
            g.fly.y = -g.fly.y * 0.45;
            g.fly.x *= 0.7;
            g.fly.z *= 0.7;
            g.bounced = true;
          } else {
            goOff(g, ctx);
            flying.splice(i, 1);
          }
        } else if (solidHit(g.at.x, g.at.y, g.at.z)) {
          goOff(g, ctx);
          flying.splice(i, 1);
        }
      }
      for (let i = banks.length - 1; i >= 0; i -= 1) {
        const bank = banks[i];
        bank.left -= dt;
        const fade = Math.min(1, bank.left / 2);
        smokeMat.opacity = 0.75 * fade;
        if (bank.left <= 0) {
          for (const m of bank.meshes) smokeGroup.remove(m);
          banks.splice(i, 1);
        }
      }
    },
    clear() {
      for (const bank of banks) {
        for (const m of bank.meshes) smokeGroup.remove(m);
      }
      banks.length = 0;
      flying.length = 0;
      state.smokes = 0;
      state.flashes = 0;
      state.chosen = 'smoke';
    },
  };
}
