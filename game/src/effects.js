// Effects: pooled tracers, impact sparks and the flash-bang overlay.
// Everything is pre-allocated: 24 tracers, 12 spark bursts. A shot never
// allocates; it takes the next free tracer from the ring and re-aims it.
import * as THREE from 'three';
import { TINTS } from './palette.js';

const TRACER_POOL = 24;
const SPARK_POOL = 12;

export function makeFx(scene, camera) {
  const tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  const allyMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(TINTS.molten),
    transparent: true,
    opacity: 0.55,
  });
  const foeMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ff5a4e'),
    transparent: true,
    opacity: 0.45,
  });
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, allyMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, left: 0 });
  }
  let tracerNext = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_POOL * 6 * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(
    sparkGeo,
    new THREE.PointsMaterial({
      color: new THREE.Color(TINTS.molten),
      size: 0.09,
      transparent: true,
      opacity: 0.9,
    }),
  );
  sparks.visible = false;
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkIn = 0;

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  // Explosion flash: one big point light, driven down over half a second.
  const boomLight = new THREE.PointLight(
    new THREE.Color(TINTS.molten),
    0,
    40,
    1.5,
  );
  scene.add(boomLight);
  let boomIn = 0;

  const fx = {
    trace(from, to, friendly) {
      const slot = tracers[tracerNext];
      tracerNext = (tracerNext + 1) % TRACER_POOL;
      tmpA.copy(to).sub(from);
      const len = tmpA.length();
      if (len < 0.1) return;
      slot.mesh.position.copy(from).addScaledVector(tmpA, 0.5);
      slot.mesh.lookAt(to);
      slot.mesh.scale.set(1, 1, len);
      slot.mesh.material = friendly ? allyMat : foeMat;
      slot.mesh.visible = true;
      slot.left = 0.07;
    },
    sparksAt(point) {
      for (let i = 0; i < SPARK_POOL * 6; i += 1) {
        sparkPos[i * 3] = point.x + (Math.random() - 0.5) * 0.25;
        sparkPos[i * 3 + 1] = point.y + (Math.random() - 0.5) * 0.25;
        sparkPos[i * 3 + 2] = point.z + (Math.random() - 0.5) * 0.25;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparks.visible = true;
      sparkIn = 0.18;
    },
    blast(point) {
      boomLight.position.copy(point).add(tmpB.set(0, 2, 0));
      boomLight.intensity = 400;
      boomIn = 0.6;
    },
    whiteout() {
      const el = document.getElementById('flash-veil');
      if (!el) return;
      el.style.opacity = '1';
      requestAnimationFrame(() => {
        el.style.transition = 'opacity 2.6s linear';
        el.style.opacity = '0';
        setTimeout(() => {
          el.style.transition = '';
        }, 2700);
      });
    },
    tick(dt) {
      for (const slot of tracers) {
        if (slot.left <= 0) continue;
        slot.left -= dt;
        if (slot.left <= 0) slot.mesh.visible = false;
      }
      if (sparkIn > 0) {
        sparkIn -= dt;
        if (sparkIn <= 0) sparks.visible = false;
      }
      if (boomIn > 0) {
        boomIn -= dt;
        boomLight.intensity = Math.max(0, (boomIn / 0.6) * 400);
      }
    },
    jolt(amount) {
      // Camera shake is a render-time offset; main.js reads this each frame.
      fx.shakeNow = Math.max(fx.shakeNow || 0, amount);
    },
    shakeNow: 0,
    settle(dt) {
      fx.shakeNow = Math.max(0, (fx.shakeNow || 0) - dt * 2.2);
      if (fx.shakeNow > 0) {
        camera.position.x += (Math.random() - 0.5) * fx.shakeNow * 0.12;
        camera.position.y += (Math.random() - 0.5) * fx.shakeNow * 0.12;
      }
    },
  };
  return fx;
}
