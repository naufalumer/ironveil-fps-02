// Grenades: a smoke that blocks bot sight and a flash that blinds defenders.
// One thrown grenade at a time per type is enough for a 5-round game; the
// flight is a simple arc with one ground bounce, then the effect. Smoke
// clouds are real objects bots test line-of-sight against (see bots.js).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const SMOKE_SECONDS = 12;
const FLASH_SECONDS = 3;
const FLASH_RADIUS = 18;
const GRAVITY = 12;

export function createGrenades(scene, map) {
  const smokeGroup = new THREE.Group();
  scene.add(smokeGroup);
  // Smoke is unlit: a lit sphere reads as a balloon under the furnace glow.
  // Flat grey, slightly flattened spheres, clustered tight.
  const smokeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#8b98a0'), transparent: true, opacity: 0.75, depthWrite: false,
  });
  const smokeGeo = new THREE.SphereGeometry(1, 12, 10);

  const thrown = []; // { pos, vel, type, bounced }
  const clouds = []; // { x, y, z, left, meshes[] }
  const state = { smoke: 0, flash: 0, selected: 'smoke' };

  const probe = new THREE.Box3();
  function hitsWorld(x, y, z) {
    probe.min.set(x - 0.12, y - 0.12, z - 0.12);
    probe.max.set(x + 0.12, y + 0.12, z + 0.12);
    for (let i = 0; i < map.colliders.length; i += 1) {
      if (probe.intersectsBox(map.colliders[i])) return true;
    }
    return false;
  }

  function detonate(g, ctx) {
    if (g.type === 'smoke') {
      const meshes = [];
      for (let i = 0; i < 7; i += 1) {
        const m = new THREE.Mesh(smokeGeo, smokeMat);
        const a = (i / 7) * Math.PI * 2;
        m.position.set(g.pos.x + Math.cos(a) * 0.9, 1.1 + (i % 3) * 0.4, g.pos.z + Math.sin(a) * 0.9);
        const s = 1.0 + (i % 3) * 0.3;
        m.scale.set(s, s * 0.6, s);
        smokeGroup.add(m);
        meshes.push(m);
      }
      clouds.push({ x: g.pos.x, y: 1.2, z: g.pos.z, left: SMOKE_SECONDS, meshes });
    } else {
      ctx.effects.flashBang();
      ctx.audio.flash();
      ctx.bots.blindAll(g.pos, FLASH_RADIUS, ctx.time + FLASH_SECONDS);
    }
  }

  return {
    state,
    clouds,
    buy(type) {
      state[type] += 1;
    },
    throwSelected(from, dir, ctx) {
      const type = state.selected;
      if (state[type] <= 0) return false;
      state[type] -= 1;
      thrown.push({
        pos: from.clone(),
        vel: dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
        type,
        bounced: false,
      });
      ctx.audio.throwGrenade();
      return true;
    },
    step(dt, ctx) {
      for (let i = thrown.length - 1; i >= 0; i -= 1) {
        const g = thrown[i];
        g.vel.y -= GRAVITY * dt;
        g.pos.addScaledVector(g.vel, dt);
        if (g.pos.y <= 0.12) {
          g.pos.y = 0.12;
          if (!g.bounced && Math.abs(g.vel.y) > 2.5) {
            g.vel.y = -g.vel.y * 0.45;
            g.vel.x *= 0.7;
            g.vel.z *= 0.7;
            g.bounced = true;
          } else {
            detonate(g, ctx);
            thrown.splice(i, 1);
          }
        } else if (hitsWorld(g.pos.x, g.pos.y, g.pos.z)) {
          detonate(g, ctx);
          thrown.splice(i, 1);
        }
      }
      for (let i = clouds.length - 1; i >= 0; i -= 1) {
        const cloud = clouds[i];
        cloud.left -= dt;
        const fade = Math.min(1, cloud.left / 2);
        smokeMat.opacity = 0.75 * fade;
        if (cloud.left <= 0) {
          for (const m of cloud.meshes) smokeGroup.remove(m);
          clouds.splice(i, 1);
        }
      }
    },
    resetRound() {
      for (const cloud of clouds) for (const m of cloud.meshes) smokeGroup.remove(m);
      clouds.length = 0;
      thrown.length = 0;
      state.smoke = 0;
      state.flash = 0;
      state.selected = 'smoke';
    },
  };
}
