// Effects: pooled tracers, impact sparks and the flash-bang overlay.
// Everything is pre-allocated: 24 tracers, 12 spark bursts. A shot never
// allocates; it takes the next free tracer from the ring and re-aims it.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const SPARK_COUNT = 12;

export function createEffects(scene, camera) {
  const tracerGeo = new THREE.BoxGeometry(0.012, 0.012, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ember), transparent: true, opacity: 0.55 });
  const foeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a4e'), transparent: true, opacity: 0.45 });
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, left: 0 });
  }
  let tracerIndex = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(SPARK_COUNT * 6 * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(
    sparkGeo,
    new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.ember), size: 0.09, transparent: true, opacity: 0.9 }),
  );
  sparks.visible = false;
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkLeft = 0;

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  // Explosion flash: one big point light, driven down over half a second.
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.ember), 0, 40, 1.5);
  scene.add(boomLight);
  let boomLeft = 0;

  return {
    tracer(from, to, friendly) {
      const slot = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
      tmpA.copy(to).sub(from);
      const len = tmpA.length();
      if (len < 0.1) return;
      slot.mesh.position.copy(from).addScaledVector(tmpA, 0.5);
      slot.mesh.lookAt(to);
      slot.mesh.scale.set(1, 1, len);
      slot.mesh.material = friendly ? tracerMat : foeMat;
      slot.mesh.visible = true;
      slot.left = 0.07;
    },
    impact(point) {
      for (let i = 0; i < SPARK_COUNT * 6; i += 1) {
        sparkPos[i * 3] = point.x + (Math.random() - 0.5) * 0.25;
        sparkPos[i * 3 + 1] = point.y + (Math.random() - 0.5) * 0.25;
        sparkPos[i * 3 + 2] = point.z + (Math.random() - 0.5) * 0.25;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparks.visible = true;
      sparkLeft = 0.18;
    },
    explosion(point) {
      boomLight.position.copy(point).add(tmpB.set(0, 2, 0));
      boomLight.intensity = 400;
      boomLeft = 0.6;
    },
    flashBang() {
      const el = document.getElementById('flash');
      if (!el) return;
      el.style.opacity = '1';
      requestAnimationFrame(() => {
        el.style.transition = 'opacity 2.6s linear';
        el.style.opacity = '0';
        setTimeout(() => { el.style.transition = ''; }, 2700);
      });
    },
    step(dt) {
      for (const slot of tracers) {
        if (slot.left <= 0) continue;
        slot.left -= dt;
        if (slot.left <= 0) slot.mesh.visible = false;
      }
      if (sparkLeft > 0) {
        sparkLeft -= dt;
        if (sparkLeft <= 0) sparks.visible = false;
      }
      if (boomLeft > 0) {
        boomLeft -= dt;
        boomLight.intensity = Math.max(0, (boomLeft / 0.6) * 400);
      }
    },
    shake(amount) {
      // Camera shake is a render-time offset; main.js reads this each frame.
      this.shakeAmount = Math.max(this.shakeAmount || 0, amount);
    },
    shakeAmount: 0,
    dampShake(dt) {
      this.shakeAmount = Math.max(0, (this.shakeAmount || 0) - dt * 2.2);
      if (this.shakeAmount > 0) {
        camera.position.x += (Math.random() - 0.5) * this.shakeAmount * 0.12;
        camera.position.y += (Math.random() - 0.5) * this.shakeAmount * 0.12;
      }
    },
  };
}
