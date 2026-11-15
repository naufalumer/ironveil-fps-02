// The operative on foot: acceleration, friction, gravity, crouch and
// jump, resolved as a box against the map's colliders one axis at a
// time, so a wall never swallows the player. One shared probe box, no
// allocation per step. Stopping to aim pays: spread in the arsenal
// module reads flat speed.
import * as THREE from 'three';

const BODY_RAD = 0.34;
const TALL_STAND = 1.72;
const TALL_CROUCH = 1.12;
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const PACE_WALK = 5.6;
const PACE_CROUCH = 2.6;
const ACCEL_GROUND = 48;
const ACCEL_AIR = 10;
const DRAG = 10;
const FALL = 21;
const LEAP = 6.4;

export function makeOperative(solids, spawnAt) {
  const state = {
    pos: new THREE.Vector3(spawnAt.x, 0, spawnAt.z),
    vel: new THREE.Vector3(),
    heading: 0,
    tilt: 0,
    eyeH: EYE_STAND,
    grounded: true,
    crouched: false,
    tall: TALL_STAND,
    hp: 100,
    living: true,
    // Pace factor for the carried gun (1 = sidearm pace, less = heavier).
    // Set by the arsenal module.
    paceFactor: 1,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // `lift` keeps the feet and the crown out of the horizontal tests, so
  // standing on the floor is not read as walking into a wall.
  function blockedBy(x, y, z, tall, lift) {
    probe.min.set(x - BODY_RAD, y + lift, z - BODY_RAD);
    probe.max.set(x + BODY_RAD, y + tall - lift, z + BODY_RAD);
    for (const solid of solids) {
      if (probe.intersectsBox(solid)) return solid;
    }
    return null;
  }

  function turn(dx, dy, sensitivity = 0.0022) {
    state.heading -= dx * sensitivity;
    state.tilt = Math.max(-1.45, Math.min(1.45, state.tilt - dy * sensitivity));
  }

  function kick(tiltKick, headingKick) {
    state.tilt = Math.min(1.45, state.tilt + tiltKick);
    state.heading += headingKick;
  }

  function updateStance(keys, dt) {
    const wantCrouch =
      keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !state.crouched) {
      state.crouched = true;
      state.tall = TALL_CROUCH;
    } else if (
      !wantCrouch &&
      state.crouched &&
      !blockedBy(state.pos.x, state.pos.y, state.pos.z, TALL_STAND, 0.02)
    ) {
      state.crouched = false;
      state.tall = TALL_STAND;
    }
    const eyeGoal = state.crouched ? EYE_CROUCH : EYE_STAND;
    state.eyeH += (eyeGoal - state.eyeH) * Math.min(1, dt * 12);
  }

  function wishDir(keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (!forward && !strafe) return wish;
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    return wish
      .set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe)
      .normalize();
  }

  function advance(dt, keys) {
    if (!state.living) return;
    updateStance(keys, dt);
    const dir = wishDir(keys);
    const pace = (state.crouched ? PACE_CROUCH : PACE_WALK) * state.paceFactor;
    const blend = Math.min(
      1,
      ((state.grounded ? ACCEL_GROUND : ACCEL_AIR) * dt) / pace,
    );
    state.vel.x += (dir.x * pace - state.vel.x) * blend;
    state.vel.z += (dir.z * pace - state.vel.z) * blend;
    if (state.grounded && !dir.lengthSq()) {
      const damp = Math.max(0, 1 - DRAG * dt);
      state.vel.x *= damp;
      state.vel.z *= damp;
    }

    if (keys.has('Space') && state.grounded) {
      state.vel.y = LEAP;
      state.grounded = false;
    }
    state.vel.y -= FALL * dt;

    const nextX = state.pos.x + state.vel.x * dt;
    if (!blockedBy(nextX, state.pos.y, state.pos.z, state.tall, 0.04)) {
      state.pos.x = nextX;
    } else {
      state.vel.x = 0;
    }
    const nextZ = state.pos.z + state.vel.z * dt;
    if (!blockedBy(state.pos.x, state.pos.y, nextZ, state.tall, 0.04)) {
      state.pos.z = nextZ;
    } else {
      state.vel.z = 0;
    }

    state.pos.y += state.vel.y * dt;
    state.grounded = false;
    const hit = blockedBy(state.pos.x, state.pos.y, state.pos.z, state.tall, 0);
    if (hit && state.vel.y <= 0) {
      state.pos.y = hit.max.y;
      state.vel.y = 0;
      state.grounded = true;
    } else if (hit) {
      state.pos.y = hit.min.y - state.tall;
      state.vel.y = 0;
    }
    if (state.pos.y < 0) {
      state.pos.y = 0;
      state.vel.y = 0;
      state.grounded = true;
    }
    state.vel.y = Math.max(-30, state.vel.y);
  }

  function respawn(spawnAt) {
    state.pos.set(spawnAt.x, 0, spawnAt.z);
    state.vel.set(0, 0, 0);
    state.heading = 0;
    state.tilt = 0;
    state.hp = 100;
    state.living = true;
    state.crouched = false;
    state.tall = TALL_STAND;
    state.eyeH = EYE_STAND;
  }

  return {
    state,
    advance,
    turn,
    kick,
    respawn,
    flatSpeed() {
      return Math.hypot(state.vel.x, state.vel.z);
    },
    eyeAt(out) {
      out.set(state.pos.x, state.pos.y + state.eyeH, state.pos.z);
      return out;
    },
  };
}
